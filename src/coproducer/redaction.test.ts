import { describe, expect, it } from 'vitest';
import type { AppSettings, Show } from '../types';
import { buildPseudonymIndex, pseudonym, viewOfSettings, viewOfShow } from './redaction';
import { sanitizeSettings, sanitizeShow } from './schema';
import { clone, FIXTURE_SECRETS, fullSettings, fullShow } from './testFixtures';

// The server's own views, when its module is in this checkout: both sides
// must produce identical JSON for the same data.
const serverModules = import.meta.glob('../../api/_lib/coproducerViews.ts');
type ServerViews = {
  coproducerShowView(show: Show): Promise<Show | null>;
  coproducerSettingsView(settings: AppSettings): Promise<AppSettings | null>;
};
const loadServer = Object.values(serverModules)[0] as (() => Promise<ServerViews>) | undefined;

const secrets = Object.values(FIXTURE_SECRETS);

describe('pseudonym', () => {
  it('matches the test vectors', async () => {
    expect(await pseudonym('A'.repeat(43))).toBe('redacted-f2409b276ca5ad9316eb97cfe3327447');
    expect(await pseudonym('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ')).toBe('redacted-3ce4c76953abccf1d64b4b6fa149dfb5');
  });

  it('gives the same answer from a view built without the index', async () => {
    const show = fullShow();
    const empty = { viewer: new Map(), signature: new Map(), profile: new Map(), reverse: new Map() };
    expect(viewOfShow(show, empty).viewToken).toBe(await pseudonym(FIXTURE_SECRETS.viewToken));
  });
});

describe('buildPseudonymIndex', () => {
  it('maps every link token in the state to where it lives', async () => {
    const show = fullShow();
    const settings = fullSettings();
    const index = await buildPseudonymIndex({ shows: [show], settings });
    expect(index.viewer.get(await pseudonym(FIXTURE_SECRETS.viewToken))).toEqual({ showId: show.id, inTrash: false, token: FIXTURE_SECRETS.viewToken });
    expect(index.viewer.get(await pseudonym(FIXTURE_SECRETS.trashViewToken))).toEqual({ showId: 'show-old', inTrash: true, token: FIXTURE_SECRETS.trashViewToken });
    expect(index.signature.get(await pseudonym(FIXTURE_SECRETS.signToken))).toEqual({ id: settings.signatureRequests[0].id, token: FIXTURE_SECRETS.signToken });
    expect(index.profile.get(await pseudonym(FIXTURE_SECRETS.profileToken))).toEqual({ id: settings.profileRequests[0].id, token: FIXTURE_SECRETS.profileToken });
    expect(index.reverse.get(FIXTURE_SECRETS.signToken)).toBe(await pseudonym(FIXTURE_SECRETS.signToken));
    expect(index.reverse.size).toBe(4);
  });
});

describe('viewOfShow and viewOfSettings', () => {
  it('carry no secret and keep everything else', async () => {
    const show = fullShow();
    const settings = fullSettings();
    const index = await buildPseudonymIndex({ shows: [show], settings });
    const shownShow = viewOfShow(show, index);
    const shownSettings = viewOfSettings(settings, index);
    const text = JSON.stringify([shownShow, shownSettings]);
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(shownShow.viewerKey).toBeUndefined();
    expect(shownShow.viewToken).toBe(await pseudonym(FIXTURE_SECRETS.viewToken));
    const strip = (value: Show) => {
      const out = clone(value) as Partial<Show>;
      delete out.viewToken;
      delete out.viewerKey;
      return out;
    };
    expect(strip(shownShow)).toEqual(strip(show));
    expect(shownSettings.signatureRequests[0]).toMatchObject({ id: settings.signatureRequests[0].id, key: '', signed: settings.signatureRequests[0].signed });
    expect(shownSettings.profileRequests![0]).toMatchObject({ key: '', submitted: settings.profileRequests![0].submitted });
    expect(shownSettings.trash[0].data.viewerKey).toBeUndefined();
  });

  it('leave the owner’s objects alone', async () => {
    const show = fullShow();
    const settings = fullSettings();
    const before = clone([show, settings]);
    const index = await buildPseudonymIndex({ shows: [show], settings });
    viewOfShow(show, index);
    viewOfSettings(settings, index);
    expect([show, settings]).toEqual(before);
  });

  it('are what the redaction rules and the schema make of the data', async () => {
    const show = fullShow();
    const settings = fullSettings();
    const index = await buildPseudonymIndex({ shows: [show], settings });
    const expectShow = clone(show) as unknown as Record<string, unknown>;
    expectShow.viewToken = await pseudonym(FIXTURE_SECRETS.viewToken);
    delete expectShow.viewerKey;
    expect(viewOfShow(show, index)).toEqual(sanitizeShow(expectShow));
    const expectSettings = clone(settings);
    expectSettings.trash[0].data.viewToken = await pseudonym(FIXTURE_SECRETS.trashViewToken);
    delete expectSettings.trash[0].data.viewerKey;
    expectSettings.signatureRequests[0] = { ...expectSettings.signatureRequests[0], token: await pseudonym(FIXTURE_SECRETS.signToken), key: '' };
    expectSettings.profileRequests![0] = { ...expectSettings.profileRequests![0], token: await pseudonym(FIXTURE_SECRETS.profileToken), key: '' };
    expect(viewOfSettings(settings, index)).toEqual(sanitizeSettings(expectSettings));
  });

  it('drop a token that is not a string, as the server does', async () => {
    const show = { ...fullShow(), viewToken: 42 } as unknown as Show;
    const index = await buildPseudonymIndex({ shows: [], settings: fullSettings() });
    expect('viewToken' in viewOfShow(show, index)).toBe(false);
  });

  it.runIf(loadServer !== undefined)('equal the server’s views for the same data', async () => {
    const server = await loadServer!();
    const show = fullShow();
    const settings = fullSettings();
    const index = await buildPseudonymIndex({ shows: [show], settings });
    expect(JSON.stringify(viewOfShow(show, index))).toBe(JSON.stringify(await server.coproducerShowView(show)));
    expect(JSON.stringify(viewOfSettings(settings, index))).toBe(JSON.stringify(await server.coproducerSettingsView(settings)));
  });
});
