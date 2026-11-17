import { describe, expect, it, vi } from 'vitest';
import type { AppSettings, Show, SignatureRequest } from '../types';
import type { AppliedPlan } from './applyRequest';
import { createOwnerData, type OwnerAppHooks } from './ownerData';
import { fullSettings, fullShow } from './testFixtures';

function app(shows: Show[], settings: AppSettings = fullSettings(), over: Partial<OwnerAppHooks> = {}) {
  const state = { shows, settings };
  const hooks: OwnerAppHooks = {
    session: { username: 'p', userId: 'u', authHash: 'a', key: 'k'.repeat(64), legacyKey: 'l'.repeat(64) },
    shows: () => state.shows,
    settings: () => state.settings,
    loaded: () => true,
    producerLocked: false,
    syncBlocked: () => false,
    setShows: vi.fn((next: Show[]) => { state.shows = next; }),
    saveSettings: vi.fn((next: AppSettings) => { state.settings = next; }),
    retireProfileLink: vi.fn(),
    openShow: vi.fn(),
    revokeSignature: vi.fn(async () => {}),
    withdrawLiveView: vi.fn(async () => {}),
    ...over,
  };
  return { state, hooks, data: createOwnerData(hooks) };
}

function plan(over: Partial<AppliedPlan> & Pick<AppliedPlan, 'after'>): AppliedPlan {
  return { upsert: [], remove: [], settingsChanged: false, withdrawals: [], ...over };
}

describe('commit', () => {
  it('writes only the shows a plan names, and keeps the rest as the owner has them now', async () => {
    const one = fullShow();
    const two = fullShow({ id: 'show2', name: 'Two' });
    const gone = fullShow({ id: 'show3', name: 'Three' });
    const { state, hooks, data } = app([one, two, gone]);
    const changed = { ...one, venueName: 'The Attic' };
    const created = fullShow({ id: 'show-new', name: 'New' });
    // The owner edits show two after the plan was made from an older copy.
    const editedTwo = { ...two, venueName: 'Owner edit' };
    state.shows = [one, editedTwo, gone];
    await data.commit(plan({ after: { shows: [created, changed, two], settings: state.settings }, upsert: ['show-new', 'show1'], remove: ['show3'] }));
    expect(state.shows).toEqual([created, changed, editedTwo]);
    expect(state.shows[2]).toBe(editedTwo);
    expect(hooks.saveSettings).not.toHaveBeenCalled();
  });

  it('saves settings only when they changed', async () => {
    const { state, data } = app([fullShow()]);
    const settings = { ...state.settings, brandName: 'New Brand' };
    await data.commit(plan({ after: { shows: state.shows, settings }, settingsChanged: true }));
    expect(state.settings.brandName).toBe('New Brand');
  });

  it('withdraws links, and puts back a signing link the server could not withdraw', async () => {
    const settings = fullSettings();
    const request: SignatureRequest = { ...settings.signatureRequests[0], signed: undefined };
    const after = { ...settings, signatureRequests: [], profileRequests: [] };
    const { state, hooks, data } = app([fullShow()], settings, {
      revokeSignature: vi.fn(async () => { throw new Error('offline'); }),
    });
    const report = await data.commit(plan({
      after: { shows: state.shows, settings: after },
      settingsChanged: true,
      withdrawals: [
        { kind: 'signature', request },
        { kind: 'profile', request: settings.profileRequests![0] },
        { kind: 'viewer', token: 'tok', showId: 'show1', showName: 'Friday Laughs' },
      ],
    }));
    expect(report).toEqual({ keptLinks: ['Sam Lee'] });
    expect(state.settings.signatureRequests).toEqual([request]);
    expect(hooks.retireProfileLink).toHaveBeenCalledWith(settings.profileRequests![0]);
    expect(hooks.withdrawLiveView).toHaveBeenCalledWith('tok', hooks.session);
  });
});

describe('commitShare', () => {
  it('files a new link row first in its list, and a viewer link on its show', () => {
    const { state, data } = app([fullShow({ viewToken: undefined, viewerKey: undefined })]);
    const request = { ...state.settings.signatureRequests[0], id: 'new', token: 'newtoken' };
    data.commitShare({ kind: 'add-signature-request', request });
    expect(state.settings.signatureRequests[0]).toBe(request);
    const profile = { ...state.settings.profileRequests![0], id: 'newp', token: 'newptoken' };
    data.commitShare({ kind: 'add-profile-request', request: profile });
    expect(state.settings.profileRequests![0]).toBe(profile);
    data.commitShare({ kind: 'viewer-link', showId: 'show1', viewToken: 'vt', viewerKey: 'vk' });
    expect(state.shows[0]).toMatchObject({ viewToken: 'vt', viewerKey: 'vk' });
  });
});

describe('withdrawHandout', () => {
  it('withdraws in the latest state and takes the rows and the viewer link off', async () => {
    const settings = fullSettings();
    const unsigned: SignatureRequest = { ...settings.signatureRequests[0], id: 'unsigned-id1', token: 'unsignedtoken', signed: undefined };
    settings.signatureRequests = [settings.signatureRequests[0], unsigned];
    const { state, hooks, data } = app([fullShow()], settings);
    const result = await data.withdrawHandout([
      { kind: 'signature', requestId: settings.signatureRequests[0].id },
      { kind: 'signature', requestId: 'unsigned-id1' },
      { kind: 'profile', requestId: settings.profileRequests![0].id },
      { kind: 'viewer', showId: 'show1' },
    ]);
    expect(result.withdrawn).toBe(3);
    expect(result.skipped).toHaveLength(1);
    expect(state.settings.signatureRequests.map((r) => r.id)).toEqual([settings.signatureRequests[0].id]);
    expect(state.settings.profileRequests).toEqual([]);
    expect(state.shows[0].viewToken).toBeUndefined();
    expect(state.shows[0].viewerKey).toBeUndefined();
    expect(hooks.revokeSignature).toHaveBeenCalledTimes(1);
  });
});
