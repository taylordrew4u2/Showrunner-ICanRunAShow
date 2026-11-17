import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileRequest, SignatureRequest } from '../types';
import type { SessionCredentials } from '../utils/session-vault';
import { clone, FIXTURE_SECRETS, fullSettings, fullShow } from './testFixtures';
import type { ShareAction } from './types';

const sendForSignature = vi.fn();
const createProfileLink = vi.fn();
const publishLiveView = vi.fn();

vi.mock('../utils/contracts', async (actual) => ({
  ...(await actual<typeof import('../utils/contracts')>()),
  sendForSignature: (...args: unknown[]) => sendForSignature(...args),
}));
vi.mock('../utils/profileLink', async (actual) => ({
  ...(await actual<typeof import('../utils/profileLink')>()),
  createProfileLink: (...args: unknown[]) => createProfileLink(...args),
}));
vi.mock('../utils/liveView', async (actual) => ({
  ...(await actual<typeof import('../utils/liveView')>()),
  publishLiveView: (...args: unknown[]) => publishLiveView(...args),
}));

const { executeShare, shareBlocker, shareDuplicateWarning, shareWarning } = await import('./executeShare');

const session: SessionCredentials = { username: 'producer', userId: 'u1', authHash: 'auth', key: 'a'.repeat(64), legacyKey: 'b'.repeat(64) };
const ORIGIN = 'https://icanrunashow.com';

function context(over: { producerLocked?: boolean; shows?: ReturnType<typeof fullShow>[]; settings?: ReturnType<typeof fullSettings> } = {}) {
  return {
    session,
    state: { shows: over.shows ?? [fullShow()], settings: over.settings ?? fullSettings() },
    origin: ORIGIN,
    producerLocked: over.producerLocked ?? false,
  };
}

beforeEach(() => {
  sendForSignature.mockReset();
  createProfileLink.mockReset();
  publishLiveView.mockReset();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copying text and opening an email', () => {
  it('need nothing from the owner’s app and no confirm', async () => {
    const copy: ShareAction = { type: 'copy-text', source: 'announce-post', showId: 'show1', text: 'Come to the show' };
    const email: ShareAction = { type: 'email', source: 'lineup', showId: 'show1', href: 'mailto:a@example.com' };
    for (const action of [copy, email]) {
      expect(shareBlocker(action, context())).toBeNull();
      expect(shareWarning(action, 'Sam', context())).toBeNull();
      expect(await executeShare(action, context())).toEqual({ ok: true, result: {} });
    }
    expect(sendForSignature).not.toHaveBeenCalled();
  });
});

describe('a new signing link', () => {
  const action: ShareAction = { type: 'signing-link', contractId: 'ct1', signer: { name: 'Jo Bloggs', email: 'jo@example.com', contactId: 'c1' } };

  it('is blocked when the contract is gone or the plan is locked', () => {
    const settings = fullSettings({ contracts: [] });
    expect(shareBlocker(action, context({ settings }))).toBe('The contract “Performer Agreement” has been deleted.');
    expect(shareBlocker(action, context({ settings: fullSettings({ contracts: [], signatureRequests: [] }) }))).toBe('That contract has been deleted.');
    expect(shareBlocker(action, context({ producerLocked: true }))).toBe('Sending contracts is part of the Producer plan.');
  });

  it('warns what the link lets its holder do, and that it outlives their access', () => {
    const warning = shareWarning(action, 'Sam', context())!;
    expect(warning.message).toBe('Give Sam a signing link for Jo Bloggs? Whoever has it can sign “Performer Agreement” as Jo Bloggs, and what they send is filed in your account. It keeps working after you withdraw Sam\'s access, until you withdraw the link.');
    expect(warning.danger).toBe(false);
  });

  it('asks first when the signer already has an unsigned link', () => {
    expect(shareDuplicateWarning(action, context())).toBeNull();
    const settings = fullSettings();
    settings.signatureRequests = [{ ...settings.signatureRequests[0], signerName: 'Jo Bloggs', contactId: undefined, signed: undefined }];
    expect(shareDuplicateWarning(action, context({ settings }))).toMatchObject({
      message: 'Jo Bloggs already has an unsigned link for this contract. Sending again makes a second link, and whichever one they open first is the one that counts.',
      confirmLabel: 'Send anyway',
    });
  });

  it('makes the link in the owner’s app, files it, and hands back the URL', async () => {
    const made: SignatureRequest = { id: 'newtoken1234', token: 'newtoken1234AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', key: 'k'.repeat(43), contractId: 'ct1', contractName: 'Performer Agreement', signerName: 'Jo Bloggs', sentAt: 'now' };
    sendForSignature.mockResolvedValue(made);
    const result = await executeShare(action, context());
    expect(sendForSignature).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ct1' }),
      { name: 'Jo Bloggs', email: 'jo@example.com', contactId: 'c1' },
      'Laugh Co',
      session,
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      effect: { kind: 'add-signature-request', request: made },
      result: { links: [{ label: '“Performer Agreement” for Jo Bloggs', url: `${ORIGIN}/sign?t=${made.token}#k=${made.key}` }] },
      handout: { links: [{ kind: 'signature', requestId: 'newtoken1234' }] },
    });
  });

  it('files a Rolodex entry only when it is still there', async () => {
    sendForSignature.mockResolvedValue({ id: 'x', token: 't', key: 'k', signerName: 'Jo' });
    await executeShare({ ...action, signer: { name: 'Jo', contactId: 'gone' } } as ShareAction, context());
    expect(sendForSignature.mock.calls[0][1]).toEqual({ name: 'Jo', email: undefined, contactId: undefined });
  });
});

describe('signing links already sent', () => {
  it('hand back each link, and a text of all of them when more than one', async () => {
    const settings = fullSettings();
    const second: SignatureRequest = { ...settings.signatureRequests[0], id: 'second-id-12', token: 'secondTokenYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY', key: 'k2', signerName: 'Pat', signed: undefined };
    settings.signatureRequests = [settings.signatureRequests[0], second];
    const action: ShareAction = { type: 'existing-signing-link', requestIds: [settings.signatureRequests[0].id, 'second-id-12'] };
    const result = await executeShare(action, context({ settings }));
    const first = `${ORIGIN}/sign?t=${FIXTURE_SECRETS.signToken}#k=${FIXTURE_SECRETS.signKey}`;
    const other = `${ORIGIN}/sign?t=${second.token}#k=k2`;
    expect(result).toEqual({
      ok: true,
      result: {
        links: [{ label: '“Performer Agreement” for Sam Lee', url: first }, { label: '“Performer Agreement” for Pat', url: other }],
        text: `Sam Lee — ${first}\nPat — ${other}`,
      },
      handout: { links: [{ kind: 'signature', requestId: settings.signatureRequests[0].id }, { kind: 'signature', requestId: 'second-id-12' }] },
    });
    expect(shareWarning(action, 'Sam', context({ settings }))!.message).toContain('the signing links for Sam Lee and Pat');
  });

  it('are blocked when none is left', () => {
    expect(shareBlocker({ type: 'existing-signing-link', requestIds: ['nope'] }, context())).toBe('Those links have been withdrawn.');
  });
});

describe('details links', () => {
  it('a new one is made for the Rolodex entry and filed', async () => {
    const made: ProfileRequest = { id: 'prof12345678', token: 'prof12345678BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', key: 'pk', personName: 'Sam Lee', sentAt: 'now', contactId: 'c1' };
    createProfileLink.mockResolvedValue(made);
    const action: ShareAction = { type: 'profile-link', contactId: 'c1' };
    expect(shareWarning(action, 'Ada', context())!.message).toBe('Give Ada a details link for Sam Lee? Whoever has it can answer it as Sam Lee, and what they send is filed in your account. It keeps working after you withdraw Ada\'s access, until you withdraw the link.');
    const result = await executeShare(action, context());
    expect(createProfileLink).toHaveBeenCalledWith({ name: 'Sam Lee', contactId: 'c1' }, 'Laugh Co', session);
    expect(result).toEqual({
      ok: true,
      effect: { kind: 'add-profile-request', request: made },
      result: { links: [{ label: 'Details link for Sam Lee', url: `${ORIGIN}/details?t=${made.token}#k=pk` }] },
      handout: { links: [{ kind: 'profile', requestId: 'prof12345678' }] },
    });
  });

  it('are blocked when the entry or the link is gone', () => {
    expect(shareBlocker({ type: 'profile-link', contactId: 'gone' }, context())).toBe('That person is no longer in your Rolodex.');
    expect(shareBlocker({ type: 'existing-profile-link', requestId: 'gone' }, context())).toBe('That details link has been withdrawn.');
  });

  it('one already sent is looked up by id', async () => {
    const settings = fullSettings();
    const id = settings.profileRequests![0].id;
    const result = await executeShare({ type: 'existing-profile-link', requestId: id }, context({ settings }));
    expect(result).toEqual({
      ok: true,
      result: { links: [{ label: 'Details link for Sam Lee', url: `${ORIGIN}/details?t=${FIXTURE_SECRETS.profileToken}#k=${FIXTURE_SECRETS.profileKey}` }] },
      handout: { links: [{ kind: 'profile', requestId: id }] },
    });
  });
});

describe('the viewer link', () => {
  it('already made: handed back with its key, nothing published', async () => {
    const result = await executeShare({ type: 'viewer-link', showId: 'show1' }, context());
    expect(publishLiveView).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      result: { links: [{ label: 'Viewer link for “Friday Laughs”', url: `${ORIGIN}/live?t=${FIXTURE_SECRETS.viewToken}#k=${FIXTURE_SECRETS.viewerKey}` }] },
      handout: { links: [{ kind: 'viewer', showId: 'show1' }] },
    });
    expect(shareWarning({ type: 'viewer-link', showId: 'show1' }, 'Sam', context())!.message).toBe('Give Sam the viewer link for “Friday Laughs”? Anyone with it can follow the show\'s public running order until you withdraw it.');
  });

  it('not made yet: published with the show’s own note first, then filed on the show', async () => {
    publishLiveView.mockResolvedValue({ stale: false });
    const show = fullShow({ viewToken: undefined, viewerKey: undefined, viewNote: 'Doors at 7.' });
    const result = await executeShare({ type: 'viewer-link', showId: 'show1' }, context({ shows: [show] }));
    expect(publishLiveView).toHaveBeenCalledTimes(1);
    const [token, payload, creds] = publishLiveView.mock.calls[0];
    expect(payload).toMatchObject({ showName: 'Friday Laughs', note: 'Doors at 7.', status: 'scheduled' });
    expect(creds).toBe(session);
    if (!result.ok) throw new Error('refused');
    expect(result.effect).toEqual({ kind: 'viewer-link', showId: 'show1', viewToken: token, viewerKey: expect.any(String) });
    const key = (result.effect as { viewerKey: string }).viewerKey;
    expect(result.result.links![0].url).toBe(`${ORIGIN}/live?t=${token}#k=${key}`);
  });

  it('is blocked when the show is gone, or a new link needs the Producer plan', () => {
    expect(shareBlocker({ type: 'viewer-link', showId: 'show-old' }, context())).toBe('“Old Show” has been deleted.');
    expect(shareBlocker({ type: 'viewer-link', showId: 'nowhere' }, context())).toBe('That show has been deleted.');
    const unlinked = fullShow({ viewToken: undefined });
    expect(shareBlocker({ type: 'viewer-link', showId: 'show1' }, context({ shows: [unlinked], producerLocked: true }))).toBe('Making a viewer link is part of the Producer plan.');
    expect(shareBlocker({ type: 'viewer-link', showId: 'show1' }, context({ producerLocked: true }))).toBeNull();
  });

  it('a link from before keys travelled with the show gets its key filed', async () => {
    const show = clone(fullShow());
    delete (show as { viewerKey?: string }).viewerKey;
    const result = await executeShare({ type: 'viewer-link', showId: 'show1' }, context({ shows: [show] }));
    if (!result.ok) throw new Error('refused');
    expect(result.effect).toMatchObject({ kind: 'viewer-link', showId: 'show1', viewToken: FIXTURE_SECRETS.viewToken });
  });
});
