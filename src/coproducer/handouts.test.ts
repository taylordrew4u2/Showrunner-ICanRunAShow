import { describe, expect, it, vi } from 'vitest';
import type { SignatureRequest } from '../types';
import { readHandoutRefs, resolveHandouts, withdrawHandoutLinks, type HandoutActions } from './handouts';
import type { OwnerState } from './redaction';
import { fullSettings, fullShow } from './testFixtures';

function state(): OwnerState {
  const settings = fullSettings();
  const unsigned: SignatureRequest = { ...settings.signatureRequests[0], id: 'unsigned-id1', token: 'unsignedTokenXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', signerName: 'Pat', signed: undefined };
  settings.signatureRequests = [settings.signatureRequests[0], unsigned];
  settings.profileRequests = [{ ...settings.profileRequests![0], submitted: undefined }];
  return { shows: [fullShow(), fullShow({ id: 'show2', name: 'No Link', viewToken: undefined })], settings };
}

describe('resolveHandouts', () => {
  it('describes each link from the owner’s data, once', () => {
    const s = state();
    const signedId = s.settings.signatureRequests[0].id;
    const profileId = s.settings.profileRequests![0].id;
    const resolved = resolveHandouts([
      { refs: { links: [{ kind: 'signature', requestId: signedId }, { kind: 'signature', requestId: 'unsigned-id1' }] } },
      { refs: { links: [{ kind: 'profile', requestId: profileId }, { kind: 'viewer', showId: 'show1' }, { kind: 'viewer', showId: 'show1' }] } },
      { refs: { links: [{ kind: 'viewer', showId: 'show2' }, { kind: 'signature', requestId: 'gone' }, { kind: 'profile', requestId: 'gone' }] } },
    ], s);
    expect(resolved.map((r) => [r.text, r.state])).toEqual([
      ['Sam Lee\'s signing link for “Performer Agreement” (signed)', 'signed'],
      ['Pat\'s signing link for “Performer Agreement” (not signed yet)', 'live'],
      ['Sam Lee\'s details link (not answered yet)', 'live'],
      ['The viewer link for “Friday Laughs”', 'live'],
      ["A viewer link that's been withdrawn", 'gone'],
      ["A signing link that's been withdrawn", 'gone'],
      ["A details link that's been withdrawn", 'gone'],
    ]);
  });

  it('an answered details link says so', () => {
    const s = fullSettings();
    const resolved = resolveHandouts([{ refs: { links: [{ kind: 'profile', requestId: s.profileRequests![0].id }] } }], { shows: [], settings: s });
    expect(resolved[0]).toMatchObject({ text: 'Sam Lee\'s details link (answered)', state: 'answered' });
  });
});

describe('readHandoutRefs', () => {
  it('keeps only well-formed references', () => {
    expect(readHandoutRefs({ links: [{ kind: 'signature', requestId: 'a' }, { kind: 'viewer', showId: 'b' }, { kind: 'viewer' }, { kind: 'other', requestId: 'c' }, 'x'] }))
      .toEqual({ links: [{ kind: 'signature', requestId: 'a' }, { kind: 'viewer', showId: 'b' }] });
    expect(readHandoutRefs(null)).toBeNull();
    expect(readHandoutRefs({ links: 'nope' })).toBeNull();
  });
});

function actions(s: OwnerState, over: Partial<HandoutActions> = {}): HandoutActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    state: () => s,
    revokeSignature: vi.fn(async () => {}),
    retireProfile: vi.fn(),
    withdrawViewer: vi.fn(async () => {}),
    removeSignatureRequests: vi.fn(),
    removeProfileRequests: vi.fn(),
    clearViewerLinks: vi.fn(),
    ...over,
  } as HandoutActions & Record<string, ReturnType<typeof vi.fn>>;
}

describe('withdrawHandoutLinks', () => {
  it('withdraws what is live and skips signed requests and missing refs', async () => {
    const s = state();
    const run = actions(s);
    const result = await withdrawHandoutLinks([
      { kind: 'signature', requestId: s.settings.signatureRequests[0].id },
      { kind: 'signature', requestId: 'unsigned-id1' },
      { kind: 'profile', requestId: s.settings.profileRequests![0].id },
      { kind: 'viewer', showId: 'show1' },
      { kind: 'viewer', showId: 'show2' },
      { kind: 'signature', requestId: 'gone' },
    ], run);
    expect(result.withdrawn).toBe(3);
    expect(result.skipped).toEqual([
      'Sam Lee\'s signing link for “Performer Agreement” (already signed)',
      "A viewer link that's been withdrawn (already withdrawn)",
      "A signing link that's been withdrawn (already withdrawn)",
    ]);
    expect(run.revokeSignature).toHaveBeenCalledTimes(1);
    expect(run.revokeSignature).toHaveBeenCalledWith(s.settings.signatureRequests[1]);
    expect(run.removeSignatureRequests).toHaveBeenCalledWith([s.settings.signatureRequests[1].token]);
    expect(run.retireProfile).toHaveBeenCalledWith(s.settings.profileRequests![0]);
    expect(run.removeProfileRequests).toHaveBeenCalledWith([s.settings.profileRequests![0].token]);
    expect(run.withdrawViewer).toHaveBeenCalledWith(s.shows[0].viewToken);
    expect(run.clearViewerLinks).toHaveBeenCalledWith(['show1']);
  });

  it('keeps a signing link the server could not withdraw, and drops one already gone there', async () => {
    const s = state();
    const offline = actions(s, { revokeSignature: vi.fn(async () => { throw Object.assign(new Error('offline'), {}); }) });
    const kept = await withdrawHandoutLinks([{ kind: 'signature', requestId: 'unsigned-id1' }], offline);
    expect(kept.withdrawn).toBe(0);
    expect(kept.skipped).toEqual(['Pat\'s signing link for “Performer Agreement” (couldn\'t be withdrawn; try again)']);
    expect(offline.removeSignatureRequests).not.toHaveBeenCalled();

    const gone = actions(s, { revokeSignature: vi.fn(async () => { throw Object.assign(new Error('gone'), { status: 404 }); }) });
    expect((await withdrawHandoutLinks([{ kind: 'signature', requestId: 'unsigned-id1' }], gone)).withdrawn).toBe(1);
    expect(gone.removeSignatureRequests).toHaveBeenCalledWith([s.settings.signatureRequests[1].token]);
  });
});
