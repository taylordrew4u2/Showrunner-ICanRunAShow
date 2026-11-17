import { describe, expect, it } from 'vitest';
import { coproducerSettingsView, coproducerShowView, pseudonym, redactSettings, redactShow } from '../../api/_lib/coproducerViews';
import { clone, FIXTURE_SECRETS, fullSettings, fullShow } from '../coproducer/testFixtures';
import type { AppSettings, Show } from '../types';

/** Every leaf of a JSON value, by path. */
function leaves(value: unknown, path: string[] = [], out = new Map<string, unknown>()): Map<string, unknown> {
  if (value && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((item, i) => [String(i), item] as const) : Object.entries(value);
    if (entries.length === 0) out.set(path.join('/'), value);
    for (const [key, item] of entries) leaves(item, [...path, key], out);
  } else {
    out.set(path.join('/'), value);
  }
  return out;
}

/** Where the fixtures keep a secret, and what the view must hold there instead. */
async function expectedSecret(path: string, value: unknown): Promise<{ redacted: unknown } | null> {
  if (/(^|\/)viewerKey$/.test(path)) return { redacted: undefined };
  if (/(^|\/)viewToken$/.test(path)) return { redacted: await pseudonym(String(value)) };
  if (/^(signatureRequests|profileRequests)\/\d+\/token$/.test(path)) return { redacted: await pseudonym(String(value)) };
  if (/^(signatureRequests|profileRequests)\/\d+\/key$/.test(path)) return { redacted: '' };
  return null;
}

/** Every leaf of `original` is in `view` unchanged, but for the secrets, which hold their redacted form. */
async function expectOnlySecretsChanged(original: unknown, view: unknown): Promise<string[]> {
  const before = leaves(original);
  const after = leaves(view);
  const secrets: string[] = [];
  for (const [path, value] of before) {
    const secret = await expectedSecret(path, value);
    if (secret) {
      secrets.push(path);
      expect(after.get(path), path).toEqual(secret.redacted);
    } else {
      expect(after.has(path), path).toBe(true);
      expect(after.get(path), path).toEqual(value);
    }
  }
  return secrets;
}

const SECRET_VALUES = Object.values(FIXTURE_SECRETS);

describe('pseudonyms', () => {
  it('match the vectors both producers’ code is held to', async () => {
    expect(await pseudonym('A'.repeat(43))).toBe('redacted-f2409b276ca5ad9316eb97cfe3327447');
    expect(await pseudonym('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ')).toBe('redacted-3ce4c76953abccf1d64b4b6fa149dfb5');
  });

  it('are the same for the same token and differ between tokens', async () => {
    expect(await pseudonym(FIXTURE_SECRETS.viewToken)).toBe(await pseudonym(FIXTURE_SECRETS.viewToken));
    expect(await pseudonym(FIXTURE_SECRETS.viewToken)).not.toBe(await pseudonym(FIXTURE_SECRETS.trashViewToken));
  });
});

describe('redaction', () => {
  it('takes the audio key off a show, pseudonymises its viewer token and keeps everything else', async () => {
    const show = fullShow();
    const view = await redactShow(show);
    expect(view.viewerKey).toBeUndefined();
    expect('viewerKey' in view).toBe(false);
    expect(view.viewToken).toBe(await pseudonym(FIXTURE_SECRETS.viewToken));
    const rest: Partial<Show> = { ...show };
    delete rest.viewToken;
    delete rest.viewerKey;
    const restView: Partial<Show> = { ...view };
    delete restView.viewToken;
    expect(restView).toEqual(rest);
    // A copy: the owner's show is left as it was.
    expect(show.viewerKey).toBe(FIXTURE_SECRETS.viewerKey);
  });

  it('leaves a show without a viewer link without one', async () => {
    const show: Show = { ...fullShow(), viewToken: undefined, viewerKey: undefined };
    delete show.viewToken;
    delete show.viewerKey;
    const view = await redactShow(show);
    expect('viewToken' in view).toBe(false);
    expect((await redactShow({ ...show, viewToken: '' })).viewToken).toBe('');
  });

  it('redacts the trash, and signing and details links, keeping ids, answers, files and inline images', async () => {
    const settings = fullSettings();
    const view = await redactSettings(settings);
    expect(view.trash[0].data.viewToken).toBe(await pseudonym(FIXTURE_SECRETS.trashViewToken));
    expect('viewerKey' in view.trash[0].data).toBe(false);
    expect(view.signatureRequests[0].token).toBe(await pseudonym(FIXTURE_SECRETS.signToken));
    expect(view.signatureRequests[0].key).toBe('');
    expect(view.signatureRequests[0].id).toBe(settings.signatureRequests[0].id);
    expect(view.signatureRequests[0].signed).toEqual(settings.signatureRequests[0].signed);
    expect(view.signatureRequests[0].signed?.headshot).toMatch(/^data:image\/png;base64,/);
    expect(view.profileRequests![0].token).toBe(await pseudonym(FIXTURE_SECRETS.profileToken));
    expect(view.profileRequests![0].key).toBe('');
    expect(view.profileRequests![0].id).toBe(settings.profileRequests![0].id);
    expect(view.profileRequests![0].submitted).toEqual(settings.profileRequests![0].submitted);
    expect(view.contracts).toEqual(settings.contracts);
    expect(view.potentialComics[0].photo).toMatch(/^media:/);
    expect(settings.signatureRequests[0].key).toBe(FIXTURE_SECRETS.signKey);
  });

  it('serves no secret of a fully filled show or settings, and every other value unchanged', async () => {
    const show = fullShow();
    const showView = await coproducerShowView(clone(show));
    const showSecrets = await expectOnlySecretsChanged(show, showView);
    expect(showSecrets.sort()).toEqual(['viewToken', 'viewerKey']);

    const settings = fullSettings();
    const settingsView = await coproducerSettingsView(clone(settings));
    const settingsSecrets = await expectOnlySecretsChanged(settings, settingsView);
    expect(settingsSecrets.sort()).toEqual([
      'profileRequests/0/key', 'profileRequests/0/token',
      'signatureRequests/0/key', 'signatureRequests/0/token',
      'trash/0/data/viewToken', 'trash/0/data/viewerKey',
    ]);

    const text = JSON.stringify([showView, settingsView]);
    for (const secret of SECRET_VALUES) expect(text).not.toContain(secret);
  });

  it('drops a link field that is not a string rather than serving it', async () => {
    const show = { ...fullShow(), viewToken: { nested: FIXTURE_SECRETS.viewToken } } as unknown as Show;
    const view = await coproducerShowView(show);
    expect(JSON.stringify(view)).not.toContain(FIXTURE_SECRETS.viewToken);
    const settings = fullSettings();
    (settings.signatureRequests[0] as unknown as Record<string, unknown>).token = [FIXTURE_SECRETS.signToken];
    expect(JSON.stringify(await coproducerSettingsView(settings))).not.toContain(FIXTURE_SECRETS.signToken);
  });
});

describe('sanitisation', () => {
  it('serves a show without a wrong-typed value or an unknown key, and long notes whole', async () => {
    const notes = 'n'.repeat(200_000);
    const show = {
      ...fullShow(),
      productionNotes: notes,
      recap: { ...fullShow().recap, attendance: '<svg onload=alert(1)>' },
      sneaky: '<script>alert(1)</script>',
    } as unknown as Show;
    const view = (await coproducerShowView(show))!;
    expect(view.recap?.attendance).toBeUndefined();
    expect('sneaky' in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain('<svg');
    expect(view.productionNotes).toBe(notes);
  });

  it('counts a show with no id as unreadable', async () => {
    expect(await coproducerShowView({ name: 'No id' } as unknown as Show)).toBeNull();
  });

  it('serves settings with unknown keys removed and the lists the screens expect', async () => {
    const settings = { ...fullSettings(), billingSecret: 'nope' } as unknown as AppSettings;
    const view = (await coproducerSettingsView(settings))!;
    expect('billingSecret' in view).toBe(false);
    expect(view.brandName).toBe('Laugh Co');
  });
});
