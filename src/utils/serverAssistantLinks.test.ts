import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sign from '../../api/sign';
import signDoc from '../../api/sign-doc';
import { applySchema } from '../../api/_lib/db';
import { loadWritableSettings, saveSettings, StaleSettingsError, type AssistantGrant } from '../../api/_lib/assistantCore';
import { CANCELLATION_RULE, contractQuestions, linkUrl, prefillAnswers, profileQuestions } from '../../api/_lib/assistantLinks';
import { callAssistantTool } from '../../api/_lib/assistantTools';
import { MAX_LINK_BYTES, MAX_LINK_TOKENS } from '../../api/_lib/linkStorage';
import { DEFAULT_SETTINGS, type AppSettings, type Contract, type ContractField, type ProfileSubmission, type Show, type SignatureRecord } from '../types';
import { DAY_OF_CANCELLATION_RULE, prefillFromShow, readSignKeyFromHash, signingUrl, withInstagramField, type SigningPayload } from './contracts';
import { decryptWithKey, encryptWithKey } from './encryption';
import { profileFields, profileUrl, type ProfilePayload } from './profileLink';
import { syncShowsWithRolodex } from './rolodex';
import { normalizeComicSettings } from './sharedComicSettings';

const connection = vi.hoisted(() => ({ db: null as Client | null }));
vi.mock('../../api/_lib/db', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/_lib/db')>(),
  ensureSchema: async () => {}, getDb: () => connection.db!,
}));

const ALL = 'shows:read shows:write shows:delete rolodex:read rolodex:write contracts:read links:send';
const key = 'a'.repeat(64);
const grant: AssistantGrant = { userId: 'producer', key, scope: ALL };
const origin = 'https://example.test';
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'assistant-links-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await applySchema(connection.db);
});
afterEach(() => { connection.db?.close(); rmSync(dir, { recursive: true, force: true }); });

const db = () => connection.db!;
const run = (sql: string, ...args: (string | number | null)[]) => db().execute({ sql, args });
type Result = Record<string, unknown> & { url: string; revision: string };
const call = (name: string, args: unknown, scope = ALL, client: Client = db()) =>
  callAssistantTool({ db: client, grant: { ...grant, scope }, origin }, name, args) as Promise<Result>;

const fields: ContractField[] = [
  { id: 'stage-name', label: 'Stage name' },
  { id: 'show-date', label: 'Show date' },
  { id: 'venue', label: 'Venue' },
  { id: 'email', label: 'Email', required: true },
];
const contract: Contract = { id: 'k-perf', name: 'Performer Agreement', fileRef: 'media:pdf-0001#2', fileName: 'agreement.pdf', sizeBytes: 1200, uploadedAt: '2026-10-01T00:00:00Z', fields };
const pdf = `data:application/pdf;base64,${'JVBERi0xLjQK'.repeat(40)}`;

function settingsFixture(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS, brandName: 'Night Owl Comedy', onboarded: true,
    potentialComics: [
      { id: 'c-sam', name: 'Sam Okafor', email: 'sam@example.com', notes: 'Great closer' },
      { id: 'c-jo', name: 'Jo Banks', socialMedia: '@jobanks' },
    ],
    contracts: [contract],
    ...patch,
  };
}

const show: Show = {
  id: 'friday', name: 'Friday Comedy', date: '2026-12-04', time: '20:00', venueName: 'The Cellar', location: 'Chicago', status: 'upcoming',
  performers: [{ id: 'p-sam', comicId: 'c-sam', name: 'Sam Okafor' }, { id: 'p-ada', name: 'Ada Cole' }],
  artists: [], schedule: [], hosts: [], djSongs: [], staff: [], vendors: [], expenses: [],
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
};

async function seed(settings: AppSettings = settingsFixture()) {
  await run('INSERT INTO user_settings (user_id, encrypted_data) VALUES (?, ?)', grant.userId, encryptWithKey(settings, key));
  await run('INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)', show.id, grant.userId, encryptWithKey(show, key));
  // The contract's PDF, as the app's media store holds it: the data URL in
  // slices, each encrypted with the account's key.
  const slices = [pdf.slice(0, 200), pdf.slice(200)];
  for (const [seq, slice] of slices.entries()) {
    await run('INSERT INTO user_media (user_id, id, seq, total, data) VALUES (?, ?, ?, ?, ?)', grant.userId, 'pdf-0001', seq, slices.length, encryptWithKey(slice, key));
  }
}
async function storedSettings(): Promise<AppSettings> {
  return decryptWithKey<AppSettings>(String((await run('SELECT encrypted_data FROM user_settings')).rows[0][0]), key);
}
async function writeSettings(settings: AppSettings) {
  await run('UPDATE user_settings SET encrypted_data = ? WHERE user_id = ?', encryptWithKey(settings, key), grant.userId);
}

/** What the person holding the link gets back from the public routes, opened with the key in its fragment. */
async function open<T>(url: string): Promise<{ payload: T; key: string; token: string }> {
  const link = new URL(url);
  const token = link.searchParams.get('t')!;
  const linkKey = readSignKeyFromHash(link.hash)!;
  const response = await sign(new Request(`${origin}/api/sign?token=${encodeURIComponent(token)}`));
  expect(response.status).toBe(200);
  const body = await response.json() as { payload: string };
  return { payload: decryptWithKey<T>(body.payload, linkKey), key: linkKey, token };
}

/** A client whose next transaction finds the settings already changed by another device. */
function racing(client: Client, meanwhile: () => Promise<void>): Client {
  let pending = true;
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'transaction') {
        return async (...args: Parameters<Client['transaction']>) => {
          if (pending) { pending = false; await meanwhile(); }
          return target.transaction(...args);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function holdLinks(count: number) {
  await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
             INSERT INTO sign_request (token, user_id, payload) SELECT 'held-link-' || i, ?, 'x' FROM n`, count, grant.userId);
}

describe('the app’s own wording and rules, restated for the server', () => {
  it.each([
    [undefined], [[]], [fields],
    [[{ id: 'x', label: 'Your IG' }]], [[{ id: 'social', label: '  ' }]],
    [[{ id: 'ok', label: 'OK to post your photo on social media?' }]], [[{ id: 'ssn', label: 'Social security number' }]],
    [[{ id: 'ssn', label: 'Social # (for the 1099)' }]], [[{ id: 'ni', label: 'NI number' }]], [[{ id: 'own', label: 'Social media account details' }]],
    [[{ id: 'stage', label: 'Stage name' }, { id: 'phone', label: 'Phone' }, { id: 'ssn', label: 'Social (for the 1099)' }]],
    [[{ id: 'w9', label: 'Social (W-9)' }, { id: 'ig', label: 'Instagram' }]], [[{ id: 'pay', label: 'Venmo @handle' }]],
    [[{ id: 'social', label: 'Social #1' }, { id: 'two', label: 'Social #2' }]], [[{ id: 'social', label: 'Main social, no links' }]],
    [[{ id: 'social', label: 'Instagram account #', required: true }, { id: 'social-2', label: 'Stage name' }]],
    [[{ id: 'social', label: 'Social #2' }, { id: 'social-2', label: 'Instagram or main social', placeholder: '@handle or a link', required: true }]],
    [[{ id: 'social', label: 'Your IG' }, { id: 'social-2', label: 'Instagram or main social', placeholder: '@handle or a link', required: true, multiline: true }]],
  ])('asks the questions withInstagramField asks: %j', given => {
    expect(contractQuestions(given)).toEqual(withInstagramField(given));
  });

  it('asks for the handle under an id of its own when its row is relabelled to ask for an ID number', () => {
    const questions = contractQuestions([{ id: 'social', label: 'Social (for the 1099)' }]);
    expect(questions.map(f => f.id)).toEqual(['social', 'social-2']);
    expect(contractQuestions([{ id: 'social', label: 'Social #1' }, { id: 'two', label: 'Social #2' }]))
      .toEqual([{ id: 'social', label: 'Social #1', required: true }, { id: 'two', label: 'Social #2' }]);
  });

  it('does not add a second, required Instagram question to one asking for social media account details', () => {
    expect(contractQuestions([{ id: 'own', label: 'Social media account details' }]))
      .toEqual([{ id: 'own', label: 'Social media account details', required: true }]);
  });

  it('fills in what prefillFromShow fills in, and words the link and its rule the same', () => {
    const context = { showName: 'Friday Comedy', date: '2026-12-04', time: '20:00', venueName: 'The Cellar', location: 'Chicago' };
    const asked = [...withInstagramField(fields), { id: 'dob', label: 'Date of birth' }, { id: 'pay', label: 'Payout email' }, { id: 'when', label: 'Set time' }, { id: 'event', label: 'Event name' }];
    expect(prefillAnswers(asked, context)).toEqual(prefillFromShow(asked, context));
    expect(prefillAnswers(asked, { showName: 'No date' })).toEqual(prefillFromShow(asked, { showName: 'No date' }));
    expect(profileQuestions()).toEqual(profileFields());
    expect(CANCELLATION_RULE).toBe(DAY_OF_CANCELLATION_RULE.body);
    expect(linkUrl(origin, 'sign', 'tok', 'k')).toBe(signingUrl(origin, 'tok', 'k'));
    expect(linkUrl(origin, 'profile', 'tok', 'k')).toBe(profileUrl(origin, 'tok', 'k'));
  });
});

describe('Rolodex', () => {
  it('lists, searches and reads entries with the shows they are booked on', async () => {
    await seed();
    const listed = await call('list_rolodex', { query: 'JOB' });
    expect(listed).toEqual({ comics: [{ id: 'c-jo', name: 'Jo Banks', socialMedia: '@jobanks', hasPhoto: false }], next_cursor: null });
    const read = await call('get_comic', { id: 'c-sam' });
    expect(read).toMatchObject({ comic: { id: 'c-sam', name: 'Sam Okafor', notes: 'Great closer' }, bookings: [{ showId: 'friday', role: 'performer', surpriseGuest: false }] });
    await expect(call('get_comic', { id: 'c-sam' }, 'shows:read')).rejects.toThrow('rolodex:read');
  });

  it('adds an entry at the top, and refuses a second entry under the same name', async () => {
    await seed();
    const added = await call('add_comic', { name: 'Kit Lane', email: 'kit@example.com', notes: '  ' });
    const comics = (await storedSettings()).potentialComics;
    expect(comics[0]).toEqual({ id: (added.comic as { id: string }).id, name: 'Kit Lane', email: 'kit@example.com' });
    await expect(call('add_comic', { name: ' kit  LANE' })).rejects.toThrow('already in the Rolodex');
    await expect(call('add_comic', { name: 'Blocked' }, 'shows:read rolodex:read')).rejects.toThrow('rolodex:write');
  });

  it('carries an edit to every booking, as the app does when the Rolodex is saved', async () => {
    await seed();
    const { revision } = await call('get_comic', { id: 'c-sam' });
    await call('update_comic', { id: 'c-sam', expected_revision: revision, patch: { name: 'Sam O.', email: '' } });
    expect((await storedSettings()).potentialComics[0]).toEqual({ id: 'c-sam', name: 'Sam O.', notes: 'Great closer' });
    const booked = decryptWithKey<Show>(String((await run('SELECT encrypted_data FROM user_shows')).rows[0][0]), key);
    expect(booked.performers[0]).toMatchObject({ comicId: 'c-sam', name: 'Sam O.' });
    expect(booked.performers[0].email).toBeUndefined();
  });

  it('refuses to rename an entry onto someone else’s name, as add_comic refuses a second entry', async () => {
    await seed();
    const { revision } = await call('get_comic', { id: 'c-sam' });
    await expect(call('update_comic', { id: 'c-sam', expected_revision: revision, patch: { name: ' jo  banks' } })).rejects.toThrow('Jo Banks is already in the Rolodex');
    expect((await storedSettings()).potentialComics[0].name).toBe('Sam Okafor');
    // A fix to the spelling of their own name is still theirs to make.
    await call('update_comic', { id: 'c-sam', expected_revision: revision, patch: { name: 'sam okafor' } });
  });

  it('refuses an edit to an entry changed since it was read', async () => {
    await seed();
    const { revision } = await call('get_comic', { id: 'c-sam' });
    await call('update_comic', { id: 'c-sam', expected_revision: revision, patch: { notes: 'Newer' } });
    await expect(call('update_comic', { id: 'c-sam', expected_revision: revision, patch: { notes: 'Stale' } })).rejects.toThrow('changed since it was read');
    expect((await storedSettings()).potentialComics[0].notes).toBe('Newer');
  });

  it('keeps a change made elsewhere to the rest of the settings', async () => {
    await seed();
    const { revision } = await call('get_comic', { id: 'c-sam' });
    await writeSettings({ ...await storedSettings(), brandName: 'Renamed Elsewhere' });
    await call('update_comic', { id: 'c-sam', expected_revision: revision, patch: { notes: 'Edited' } });
    const settings = await storedSettings();
    expect(settings.brandName).toBe('Renamed Elsewhere');
    expect(settings.potentialComics[0].notes).toBe('Edited');
  });

  it('refuses rather than overwrite settings another device saved while it was writing', async () => {
    await seed();
    const { revision } = await call('get_comic', { id: 'c-sam' });
    const newer = { ...settingsFixture(), brandName: 'Saved On A Phone' };
    const client = racing(db(), () => writeSettings(newer));
    await expect(call('update_comic', { id: 'c-sam', expected_revision: revision, patch: { notes: 'Lost race' } }, ALL, client)).rejects.toThrow('changed while this was being saved');
    expect(await storedSettings()).toEqual(newer);

    const loaded = await loadWritableSettings({ db: db(), grant, origin });
    await writeSettings({ ...newer, brandName: 'Newer Still' });
    await expect(saveSettings({ db: db(), grant, origin }, loaded, { ...loaded.settings, rules: 'x' })).rejects.toBeInstanceOf(StaleSettingsError);
    expect((await storedSettings()).brandName).toBe('Newer Still');
  });
});

describe('contracts:read', () => {
  async function seedRequests() {
    await seed(settingsFixture({
      signatureRequests: [
        { id: 'sig-signed', token: 'token-signed-0000000001', key: 'secret-link-key-1', contractId: 'k-perf', contractName: 'Performer Agreement', contactId: 'c-sam', signerName: 'Sam Okafor', sentAt: '2026-11-02T00:00:00Z',
          signed: { signedAt: '2026-11-03T00:00:00Z', typedName: 'Sam Okafor', fields: [{ label: 'Stage name', value: 'Big Sam' }], headshot: 'data:image/png;base64,SECRETPHOTO', documentHash: 'abc' } },
        { id: 'sig-landed', token: 'token-landed-0000000002', key: 'secret-link-key-2', contractId: 'k-perf', contractName: 'Performer Agreement', signerName: 'Ada Cole', sentAt: '2026-11-04T00:00:00Z' },
        { id: 'sig-waiting', token: 'token-waiting-000000003', key: 'secret-link-key-3', contractId: 'k-perf', contractName: 'Performer Agreement', signerName: 'Lee Park', sentAt: '2026-11-05T00:00:00Z' },
      ],
      profileRequests: [{ id: 'prof-1', token: 'token-profile-000000004', key: 'secret-link-key-4', contactId: 'c-jo', personName: 'Jo Banks', sentAt: '2026-11-06T00:00:00Z' }],
    }));
    for (const token of ['token-signed-0000000001', 'token-landed-0000000002', 'token-waiting-000000003', 'token-profile-000000004']) {
      await run('INSERT INTO sign_request (token, user_id, payload) VALUES (?, ?, ?)', token, grant.userId, 'ciphertext');
    }
    // Ada signed on her link; the app has not been opened to file it yet.
    await run("UPDATE sign_request SET signature = 'ciphertext', signed_at = '2026-11-05 10:00:00' WHERE token = 'token-landed-0000000002'");
  }

  it('lists templates with what they ask and how many came back, never the document', async () => {
    await seedRequests();
    const result = await call('list_contracts', {});
    expect(result.contracts).toEqual([{
      id: 'k-perf', name: 'Performer Agreement', fileName: 'agreement.pdf', sizeBytes: 1200, uploadedAt: '2026-10-01T00:00:00Z',
      questions: withInstagramField(fields).map(f => ({ label: f.label, required: f.required === true })),
      sent: 3, signed: 2, waiting: 1,
    }]);
    expect(JSON.stringify(result)).not.toContain('media:');
  });

  it('says who has answered, by show, without link keys, tokens or headshots', async () => {
    await seedRequests();
    const all = await call('list_signature_requests', {});
    expect((all.requests as { id: string; status: string }[]).map(r => [r.id, r.status])).toEqual([
      ['prof-1', 'waiting'], ['sig-waiting', 'waiting'], ['sig-landed', 'answered'], ['sig-signed', 'answered'],
    ]);
    expect(all.requests).toContainEqual(expect.objectContaining({ id: 'sig-landed', answeredAt: '2026-11-05 10:00:00', filedInApp: false }));
    expect(all.requests).toContainEqual(expect.objectContaining({
      id: 'sig-signed', signedAs: 'Sam Okafor', questions: [{ label: 'Stage name', answered: true }], contactDetails: {},
    }));
    const text = JSON.stringify(all);
    for (const secret of ['secret-link-key', 'token-', 'SECRETPHOTO', 'Big Sam']) expect(text).not.toContain(secret);

    const byShow = await call('list_signature_requests', { show_id: 'friday', kind: 'contract' });
    expect((byShow.requests as { id: string }[]).map(r => r.id)).toEqual(['sig-landed', 'sig-signed']);
    expect(byShow.lineup).toEqual([
      { performerId: 'p-sam', comicId: 'c-sam', name: 'Sam Okafor', role: 'performer', surpriseGuest: false, paperwork: 'signed' },
      { performerId: 'p-ada', name: 'Ada Cole', role: 'performer', surpriseGuest: false, paperwork: 'signed' },
    ]);
    await expect(call('list_signature_requests', {}, 'shows:read shows:write')).rejects.toThrow('contracts:read');
  });

  it('returns only the contact details the app files, and whether each question was answered', async () => {
    await seed(settingsFixture({
      signatureRequests: [{
        id: 'sig-paid', token: 'token-paid-000000000005', key: 'secret-link-key-5', contractId: 'k-perf', contractName: 'Performer Agreement', signerName: 'Sam Okafor', sentAt: '2026-11-02T00:00:00Z',
        signed: {
          signedAt: '2026-11-03T00:00:00Z', typedName: 'Sam Okafor', documentHash: 'abc',
          fields: [
            { label: 'Email', value: 'sam@example.com' },
            { label: 'Best number for show-day texts', value: '555 0142' },
            // Asked before the handle, and once filed as the handle "@012-34-5678".
            { label: 'Social # (for the 1099)', value: '012-34-5678' },
            { label: 'Instagram or main social', value: 'instagram.com/bigsam/' },
            { label: 'How should we introduce you?', value: 'Big Sam, as seen on Comedy Central' },
            { label: 'Walk-on song', value: 'Shout, the Isley Brothers' },
            { label: 'Where should we send your fee?', value: 'Chase 000123456789 / 021000021' },
            { label: 'Payout email', value: 'payouts-sam@example.com' },
            { label: 'Venmo', value: '@big-sam-pay' },
            { label: 'Mailing address', value: '12 Main St, Chicago' },
            { label: 'Dietary needs', value: '' },
          ],
        },
      }],
      profileRequests: [{ id: 'prof-2', token: 'token-profile-000000006', key: 'secret-link-key-6', contactId: 'c-jo', personName: 'Jo Banks', sentAt: '2026-11-06T00:00:00Z',
        submitted: { submittedAt: '2026-11-07T00:00:00Z', typedName: 'Jo Banks', fields: [{ label: 'Email', value: 'jo@example.com' }, { label: 'Phone', value: '555-0101' }, { label: 'Instagram or main social', value: '' }] } }],
    }));
    const result = await call('list_signature_requests', {});
    const request = (id: string) => (result.requests as { id: string }[]).find(r => r.id === id) as Record<string, unknown>;
    expect(request('sig-paid')).toMatchObject({
      questions: [
        { label: 'Email', answered: true }, { label: 'Best number for show-day texts', answered: true }, { label: 'Social # (for the 1099)', answered: true },
        { label: 'Instagram or main social', answered: true }, { label: 'How should we introduce you?', answered: true }, { label: 'Walk-on song', answered: true },
        { label: 'Where should we send your fee?', answered: true }, { label: 'Payout email', answered: true }, { label: 'Venmo', answered: true },
        { label: 'Mailing address', answered: true }, { label: 'Dietary needs', answered: false },
      ],
      contactDetails: {
        email: 'sam@example.com', phone: '555 0142', socialMedia: '@bigsam',
        credits: 'Big Sam, as seen on Comedy Central', walkOnMusicName: 'Shout, the Isley Brothers',
      },
    });
    expect(request('sig-paid')).not.toHaveProperty('answers');
    expect(request('prof-2')).toMatchObject({
      questions: [{ label: 'Email', answered: true }, { label: 'Phone', answered: true }, { label: 'Instagram or main social', answered: false }],
      contactDetails: { email: 'jo@example.com', phone: '555-0101' },
    });
    const text = JSON.stringify(result);
    for (const secret of ['012-34', '000123456789', '021000021', 'Chase', 'payouts-sam', 'big-sam-pay', '12 Main St']) expect(text).not.toContain(secret);
  });

  it('returns no tax, bank or payment answer from any tool once the app has filed the contract', async () => {
    // Filed through the app's own save path, and the show synced with the
    // Rolodex, as the app does. Each of these questions once put its answer
    // on Sam as his handle or his credits, and every read tool showed it.
    const answered = settingsFixture({
      signatureRequests: [{
        id: 'sig-tax', token: 'token-tax-0000000000009', key: 'secret-link-key-9', contractId: 'k-perf', contractName: 'Performer Agreement',
        signerName: 'Sam Okafor', contactId: 'c-sam', sentAt: '2026-11-02T00:00:00Z',
        signed: {
          signedAt: '2026-11-03T00:00:00Z', typedName: 'Sam Okafor', documentHash: 'abc',
          fields: [
            { label: 'Stage name', value: 'Sam Okafor' },
            { label: 'Phone', value: '312-555-0199' },
            { label: 'Social (for the 1099)', value: '123-45-6789' },
            { label: 'Social (W-9)', value: '123-45-6789' },
            { label: 'Last four digits of your social', value: '6789' },
            { label: 'W9 info: name, address, social', value: 'Sam Okafor, 1 Elm St, 123-45-6789' },
            { label: 'Credit union account (for direct deposit)', value: 'Alliant CU 0047712345 routing 271081528' },
            { label: 'Venmo handle (for your fee)', value: '@sam-okafor-pay' },
            { label: 'Instagram', value: '@samcomedy' },
          ],
        },
      }],
    });
    const settings = normalizeComicSettings(answered, settingsFixture());
    await seed(settings);
    const [synced] = syncShowsWithRolodex(settings.potentialComics, [show]);
    await run('UPDATE user_shows SET encrypted_data = ? WHERE id = ?', encryptWithKey(synced, key), show.id);

    const listed = await call('list_signature_requests', {});
    expect((listed.requests as Record<string, unknown>[])[0].contactDetails).toEqual({ phone: '312-555-0199', socialMedia: '@samcomedy' });
    const comic = await call('get_comic', { id: 'c-sam' });
    expect(comic.comic).toMatchObject({ phone: '312-555-0199', socialMedia: '@samcomedy' });
    const reads = JSON.stringify([
      listed, comic, await call('list_rolodex', {}), await call('fetch', { id: 'comic:c-sam' }),
      await call('get_show', { id: 'friday' }), await call('fetch', { id: 'show:friday' }),
    ]);
    expect(reads).toContain('@samcomedy');
    for (const secret of ['123-45', '@6789', 'Elm St', '0047712345', '271081528', 'Alliant', 'sam-okafor-pay']) expect(reads).not.toContain(secret);
    expect((await call('search', { query: '123-45-6789' })).results).toEqual([]);
  });

  it('reads past a malformed record without losing the others', async () => {
    // The signer's browser writes the record, so its answers can be any shape.
    const malformed = (id: string, fields: unknown) => ({
      id, token: `token-${id}-000000000000`, key: `secret-link-key-${id}`, contractId: 'k-perf', contractName: 'Performer Agreement', signerName: `Signer ${id}`, sentAt: '2026-11-04T00:00:00Z',
      signed: { signedAt: '2026-11-05T00:00:00Z', typedName: `Signer ${id}`, documentHash: 'abc', fields } as unknown as SignatureRecord,
    });
    await seed(settingsFixture({
      signatureRequests: [
        malformed('text', 'Email: odd@example.com'),
        malformed('object', { 0: { label: 'Email', value: 'odd@example.com' }, length: 1 }),
        malformed('entries', [null, 7, 'Email', ['Email', 'odd@example.com'], { label: 5, value: 'x' }, { value: 'odd@example.com' },
          { label: 'Email' }, { label: 'Email', value: { address: 'odd@example.com' } }, { label: 'Phone', value: null }, { label: 'Phone', value: 5550142 }]),
        { id: 'sig-fine', token: 'token-fine-000000000007', key: 'secret-link-key-7', contractId: 'k-perf', contractName: 'Performer Agreement', signerName: 'Sam Okafor', sentAt: '2026-11-02T00:00:00Z',
          signed: { signedAt: '2026-11-03T00:00:00Z', typedName: 'Sam Okafor', documentHash: 'abc', fields: [{ label: 'Email', value: 'sam@example.com' }] } },
        { ...malformed('names', []), signed: { signedAt: 7, typedName: { name: 'x' }, signerName: null, documentHash: 'abc' } as unknown as SignatureRecord },
      ],
      profileRequests: [{ id: 'prof-odd', token: 'token-profile-000000008', key: 'secret-link-key-8', personName: 'Jo Banks', sentAt: '2026-11-06T00:00:00Z',
        submitted: { submittedAt: '2026-11-07T00:00:00Z', typedName: 'Jo Banks', fields: null } as unknown as ProfileSubmission }],
    }));
    const result = await call('list_signature_requests', {});
    const request = (id: string) => (result.requests as { id: string }[]).find(r => r.id === id) as Record<string, unknown>;
    expect((result.requests as { id: string }[]).map(r => r.id).sort()).toEqual(['entries', 'names', 'object', 'prof-odd', 'sig-fine', 'text']);
    const cameBack = (id: string) => {
      const { status, questions, contactDetails } = request(id);
      return { status, questions, contactDetails };
    };
    expect(cameBack('sig-fine')).toEqual({ status: 'answered', questions: [{ label: 'Email', answered: true }], contactDetails: { email: 'sam@example.com' } });
    expect(cameBack('text')).toEqual({ status: 'answered', questions: [], contactDetails: {} });
    expect(cameBack('object')).toEqual({ status: 'answered', questions: [], contactDetails: {} });
    expect(cameBack('entries')).toEqual({
      status: 'answered',
      questions: [{ label: 'Email', answered: false }, { label: 'Email', answered: false }, { label: 'Phone', answered: false }, { label: 'Phone', answered: true }],
      contactDetails: { phone: '5550142' },
    });
    // A record that came back is answered, whatever its date and names say.
    expect(cameBack('names')).toEqual({ status: 'answered', questions: [], contactDetails: {} });
    expect(request('names').signedAs).toBeUndefined();
    expect(request('names')).not.toHaveProperty('answeredAt');
    expect(cameBack('prof-odd')).toEqual({ status: 'answered', questions: [], contactDetails: {} });
    expect(JSON.stringify(result)).not.toContain('odd@example.com');
  });
});

describe('send_profile_link', () => {
  it('makes a link the person can open, files it, and contacts nobody', async () => {
    await seed();
    await expect(call('send_profile_link', { comic_id: 'c-jo' })).rejects.toThrow('confirm');
    await expect(call('send_profile_link', { comic_id: 'c-jo', confirm: true }, 'shows:read rolodex:read')).rejects.toThrow('links:send');
    const result = await call('send_profile_link', { comic_id: 'c-jo', confirm: true });
    expect(result.url).toMatch(new RegExp(`^${origin}/details\\?t=[A-Za-z0-9_-]{43}#k=[A-Za-z0-9_-]{43}$`));
    const opened = await open<ProfilePayload>(result.url);
    expect(opened.payload).toEqual({ kind: 'profile', fromName: 'Night Owl Comedy', personName: 'Jo Banks', fields: profileFields(), createdAt: opened.payload.createdAt });
    // Stored as ciphertext under the link's own key, owned by the producer.
    const row = (await run('SELECT user_id, payload FROM sign_request WHERE token = ?', opened.token)).rows[0];
    expect(row[0]).toBe(grant.userId);
    expect(String(row[1])).not.toContain('Jo Banks');
    const filed = (await storedSettings()).profileRequests!;
    expect(filed).toEqual([{ id: opened.token.slice(0, 12), token: opened.token, key: opened.key, contactId: 'c-jo', personName: 'Jo Banks', sentAt: filed[0].sentAt }]);
    expect(profileUrl(origin, filed[0].token, filed[0].key)).toBe(result.url);

    await expect(call('send_profile_link', { comic_id: 'c-jo', confirm: true })).rejects.toThrow('already has a profile link waiting');
  });

  it('files the link into settings saved meanwhile on another device, without losing either', async () => {
    await seed();
    const client = racing(db(), () => writeSettings({ ...settingsFixture(), brandName: 'Saved On A Phone' }));
    await call('send_profile_link', { comic_id: 'c-jo', confirm: true }, ALL, client);
    const settings = await storedSettings();
    expect(settings.brandName).toBe('Saved On A Phone');
    expect(settings.profileRequests).toHaveLength(1);
  });

  it('honours the account’s allowance for links and leaves nothing behind when it is full', async () => {
    await seed();
    await holdLinks(MAX_LINK_TOKENS);
    await expect(call('send_profile_link', { comic_id: 'c-jo', confirm: true })).rejects.toThrow('storage limit for links');
    expect((await run('SELECT COUNT(*) FROM sign_request WHERE user_id = ?', grant.userId)).rows[0][0]).toBe(MAX_LINK_TOKENS);
    expect((await storedSettings()).profileRequests ?? []).toEqual([]);
  });
});

describe('send_contract', () => {
  it('makes a signing link with the document under the link’s key and the show filled in, as the app sends it', async () => {
    await seed();
    const result = await call('send_contract', { contract_id: 'k-perf', comic_id: 'c-sam', confirm: true });
    const opened = await open<SigningPayload>(result.url);
    expect(result.url).toBe(signingUrl(origin, opened.token, opened.key));
    const asked = withInstagramField(fields);
    // Sent from the library: the soonest upcoming show Sam is booked on.
    const prefill = prefillFromShow(asked, { showName: 'Friday Comedy', date: '2026-12-04', time: '20:00', venueName: 'The Cellar', location: 'Chicago' });
    expect(opened.payload).toEqual({
      contractName: 'Performer Agreement', signerName: 'Sam Okafor', fromName: 'Night Owl Comedy', fileName: 'agreement.pdf',
      total: 2, createdAt: opened.payload.createdAt, fields: asked, prefill, cancellationRule: DAY_OF_CANCELLATION_RULE.body,
    });
    expect(Object.keys(prefill)).toEqual(['show-date', 'venue']);
    expect(result.prefilled).toEqual(['Show date', 'Venue']);

    // The signing page reassembles the PDF chunk by chunk with the same key.
    const parts: string[] = [];
    for (let seq = 0; seq < 2; seq++) {
      const response = await signDoc(new Request(`${origin}/api/sign-doc?token=${encodeURIComponent(opened.token)}&seq=${seq}`));
      const body = await response.json() as { data: string; total: number };
      expect(body.total).toBe(2);
      parts.push(decryptWithKey<string>(body.data, opened.key));
    }
    expect(parts.join('')).toBe(pdf);
    expect((await run('SELECT DISTINCT user_id FROM sign_doc')).rows.map(r => r[0])).toEqual([grant.userId]);

    const filed = (await storedSettings()).signatureRequests;
    expect(filed).toEqual([{
      id: opened.token.slice(0, 12), token: opened.token, key: opened.key, contractId: 'k-perf', contractName: 'Performer Agreement',
      contactId: 'c-sam', signerName: 'Sam Okafor', signerEmail: 'sam@example.com', sentAt: filed[0].sentAt,
    }]);
  });

  it('asks before a second unsigned link to the same person, and fills in from the show it is sent for', async () => {
    await seed();
    await call('send_contract', { contract_id: 'k-perf', name: 'Ada Cole', confirm: true });
    await expect(call('send_contract', { contract_id: 'k-perf', name: ' ada cole ', confirm: true })).rejects.toThrow('send_again');
    const again = await call('send_contract', { contract_id: 'k-perf', name: 'Ada Cole', email: 'ada@example.com', show_id: 'friday', send_again: true, confirm: true });
    const opened = await open<SigningPayload>(again.url);
    expect(opened.payload.prefill).toMatchObject({ venue: 'The Cellar — Chicago' });
    const filed = (await storedSettings()).signatureRequests;
    expect(filed.map(r => [r.signerName, r.signerEmail, r.contactId])).toEqual([['Ada Cole', 'ada@example.com', undefined], ['Ada Cole', undefined, undefined]]);
  });

  it('refuses when the account’s links are full, and withdraws what it had stored', async () => {
    await seed();
    await run("INSERT INTO sign_doc (token, seq, total, data, user_id, bytes) VALUES ('held-document-0001', 0, 1, 'x', ?, ?)", grant.userId, MAX_LINK_BYTES - 10);
    await expect(call('send_contract', { contract_id: 'k-perf', name: 'Ada Cole', confirm: true })).rejects.toThrow('storage limit for links');
    expect((await run('SELECT token FROM sign_doc')).rows.map(r => r[0])).toEqual(['held-document-0001']);
    expect((await run('SELECT COUNT(*) FROM sign_request')).rows[0][0]).toBe(0);
    expect((await storedSettings()).signatureRequests).toEqual([]);
  });

  it('says plainly when a document cannot be sent from here, and where to send it instead', async () => {
    await seed(settingsFixture({ contracts: [{ ...contract, fileRef: 'media:pdf-0001#9' }, { ...contract, id: 'k-missing', fileRef: 'media:gone-0001#1' }] }));
    await expect(call('send_contract', { contract_id: 'k-perf', name: 'Ada Cole', confirm: true })).rejects.toThrow(`too large to send from here. Send it from the app instead: More → Contracts → Performer Agreement (${origin})`);
    await expect(call('send_contract', { contract_id: 'k-missing', name: 'Ada Cole', confirm: true })).rejects.toThrow('could not be found');
    expect((await run('SELECT COUNT(*) FROM sign_doc')).rows[0][0]).toBe(0);
    expect((await storedSettings()).signatureRequests).toEqual([]);
  });

  describe('on the free plan', () => {
    // Stripe set up, as in production: the app then shows a free account a
    // Producer lock in place of Send. Unset (the other tests), nothing is locked.
    beforeEach(() => {
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
      vi.stubEnv('STRIPE_PRICE_ID', 'price_producer');
    });
    afterEach(() => { vi.unstubAllEnvs(); });
    const account = (createdAt: string, status?: string) => Promise.all([
      run('INSERT INTO users (id, password_hash, created_at) VALUES (?, ?, ?)', grant.userId, 'hash', createdAt),
      ...(status ? [run('INSERT INTO subscription (user_id, status) VALUES (?, ?)', grant.userId, status)] : []),
    ]);

    it('refuses to make a contract signing link, says why, and leaves nothing behind', async () => {
      await seed();
      await account('2026-10-10 12:00:00');
      await expect(call('send_contract', { contract_id: 'k-perf', comic_id: 'c-sam', confirm: true })).rejects.toThrow(
        'Sending contracts for signature isn’t included in this account’s current plan, so no link was made. Profile links (send_profile_link) are included.',
      );
      for (const table of ['sign_request', 'sign_doc']) expect((await run(`SELECT COUNT(*) FROM ${table}`)).rows[0][0]).toBe(0);
      expect((await storedSettings()).signatureRequests).toEqual([]);
      // Profile links are free in the app, so they are here.
      expect((await call('send_profile_link', { comic_id: 'c-jo', confirm: true })).url).toContain('/details?t=');
    });

    it.each([
      ['a founding member', '2026-09-01 12:00:00', undefined],
      ['a paying Producer', '2026-10-10 12:00:00', 'active'],
      ['a Producer whose card Stripe is retrying', '2026-10-10 12:00:00', 'past_due'],
    ])('makes the link for %s, as /api/billing calls them Producer', async (_who, createdAt, status) => {
      await seed();
      await account(createdAt, status);
      expect((await call('send_contract', { contract_id: 'k-perf', comic_id: 'c-sam', confirm: true })).url).toContain('/sign?t=');
    });
  });

  it('needs links:send and the producer’s go-ahead', async () => {
    await seed();
    await expect(call('send_contract', { contract_id: 'k-perf', name: 'Ada Cole' })).rejects.toThrow('confirm');
    await expect(call('send_contract', { contract_id: 'k-perf', name: 'Ada Cole', confirm: true }, 'shows:read contracts:read')).rejects.toThrow('links:send');
    expect((await run('SELECT COUNT(*) FROM sign_request')).rows[0][0]).toBe(0);
  });
});
