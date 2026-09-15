import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings, type SignatureRequest, type ProfileRequest } from '../types';
import { mergeSettingsEdit } from './mergeSettingsEdit';

const signature = (id: string, over: Partial<SignatureRequest> = {}): SignatureRequest => ({
  id, token: `token-${id}`, key: `key-${id}`, contractId: 'contract', contractName: 'Agreement',
  signerName: id, sentAt: '2026-09-01', ...over,
});
const settings = (over: Partial<AppSettings> = {}): AppSettings => ({ ...DEFAULT_SETTINGS, ...over });
const receipt = { typedName: 'Ada Cole', signedAt: '2026-09-15', documentHash: 'hash' };
const profile = (id: string, over: Partial<ProfileRequest> = {}): ProfileRequest => ({
  id, token: `profile-${id}`, key: 'profile-key', personName: id, sentAt: '2026-09-01', ...over,
});

describe('merging settings edits from captured async snapshots', () => {
  it('records a signature without losing a newly created signing link or newer brand settings', () => {
    const waiting = signature('ada');
    const newLink = signature('jo');
    const baseline = settings({ brandName: 'Old brand', rules: 'Old notes', signatureRequests: [waiting] });
    const incoming = { ...baseline, signatureRequests: [{ ...waiting, signed: receipt }] };
    const current = { ...baseline, brandName: 'Current brand', rules: 'Current notes', signatureRequests: [newLink, waiting] };
    const result = mergeSettingsEdit(baseline, incoming, current);
    expect(result.brandName).toBe('Current brand');
    expect(result.rules).toBe('Current notes');
    expect(result.signatureRequests).toEqual([newLink, { ...waiting, signed: receipt }]);
    expect(result.signatureRequests[0]).toBe(newLink);
    expect(current.signatureRequests[1].signed).toBeUndefined();
  });

  it('preserves a newer receipt, identity binding, and filing marker when a stale row edits another property', () => {
    const old = signature('ada', { signed: { ...receipt, headshot: 'data:image/jpeg;base64,old' } });
    const baseline = settings({ signatureRequests: [old] });
    const incoming = { ...baseline, signatureRequests: [{ ...structuredClone(old), contractName: 'Updated label' }] };
    const latest = { ...old, contactId: 'comic-ada', profileFiled: true, signed: { ...receipt, headshot: 'media:filed' } };
    const result = mergeSettingsEdit(baseline, incoming, { ...baseline, signatureRequests: [latest] });
    expect(result.signatureRequests[0]).toEqual({ ...latest, contractName: 'Updated label' });
    expect(result.signatureRequests[0].signed).toBe(latest.signed);
  });

  it('applies a deliberate request deletion while retaining current-only tokens', () => {
    const old = signature('ada');
    const newLink = signature('jo');
    const baseline = settings({ signatureRequests: [old] });
    const current = { ...baseline, signatureRequests: [newLink, old] };
    expect(mergeSettingsEdit(baseline, { ...baseline, signatureRequests: [] }, current).signatureRequests).toEqual([newLink]);
  });

  it('does not resurrect a request removed while its refresh was in flight', () => {
    const old = signature('ada');
    const baseline = settings({ signatureRequests: [old] });
    const current = { ...baseline, signatureRequests: [] };
    const incoming = { ...baseline, signatureRequests: [{ ...old, signed: receipt }] };
    expect(mergeSettingsEdit(baseline, incoming, current)).toBe(current);
  });

  it('applies a late profile response using the initiating snapshot after the user adds a link and binds identity', async () => {
    const oldRequest = profile('ada');
    const baseline = settings({ profileRequests: [oldRequest], rules: 'Initial notes' });
    let current = baseline;
    let complete!: (requests: ProfileRequest[]) => void;
    const fetched = new Promise<ProfileRequest[]>((resolve) => { complete = resolve; });
    // Capture the writer from the same render that started the fetch.
    const onFound = (updated: ProfileRequest[]) => {
      current = mergeSettingsEdit(baseline, { ...baseline, profileRequests: updated }, current);
    };
    const refresh = fetched.then(onFound);
    const newLink = profile('jo');
    current = { ...baseline, rules: 'Edited while waiting', profileRequests: [newLink, { ...oldRequest, contactId: 'comic-ada' }] };
    const submitted = { submittedAt: '2026-09-15', typedName: 'Ada', fields: [{ label: 'Email', value: 'ada@example.com' }] };
    complete([{ ...oldRequest, submitted }]);
    await refresh;
    expect(current.rules).toBe('Edited while waiting');
    expect(current.profileRequests).toEqual([newLink, { ...oldRequest, contactId: 'comic-ada', submitted }]);
  });

  it('preserves a profile request created while an older profile reply was being fetched', () => {
    const older = profile('ada');
    const newer = profile('jo');
    const submitted = { submittedAt: '2026-09-15', typedName: 'Ada', fields: [{label: 'Email', value: 'ada@example.com'}] };
    const baseline = settings({ profileRequests: [older] });
    const current = { ...baseline, profileRequests: [newer, { ...older, contactId: 'comic-ada' }] };
    const result = mergeSettingsEdit(baseline, { ...baseline, profileRequests: [{ ...older, submitted }] }, current);
    expect(result.profileRequests).toEqual([newer, { ...older, contactId: 'comic-ada', submitted }]);
  });

  it('merges profile deltas without replacing a newer photo or dropping concurrently added comics', () => {
    const ada = { id: 'ada', name: 'Ada', photo: 'media:old', notes: 'Old notes' };
    const jo = { id: 'jo', name: 'Jo' };
    const baseline = settings({ potentialComics: [ada] });
    const current = { ...baseline, potentialComics: [jo, { ...ada, photo: 'media:new' }] };
    const result = mergeSettingsEdit(baseline, { ...baseline, potentialComics: [{ ...ada, notes: 'New notes' }] }, current);
    expect(result.potentialComics).toEqual([jo, { ...ada, photo: 'media:new', notes: 'New notes' }]);
  });

  it('merges edited contract properties while keeping other contracts and newer document data', () => {
    const old = { id: 'contract', name: 'Old title', fileName: 'old.pdf', fileRef: 'media:old', sizeBytes: 100, uploadedAt: '2026-09-01' };
    const another = { ...old, id: 'another', name: 'Another agreement' };
    const baseline = settings({ contracts: [old] });
    const current = { ...baseline, contracts: [another, { ...old, fileRef: 'media:new' }] };
    const result = mergeSettingsEdit(baseline, { ...baseline, contracts: [{ ...old, name: 'New title' }] }, current);
    expect(result.contracts).toEqual([another, { ...old, name: 'New title', fileRef: 'media:new' }]);
  });

  it('honors explicit top-level clearing without undoing unrelated newer fields', () => {
    const baseline = settings({ rules: 'Clear these', remoteMusicKey: 'Space' });
    const incoming = { ...baseline, rules: '', remoteMusicKey: undefined };
    const current = { ...baseline, brandName: 'Current brand' };
    const result = mergeSettingsEdit(baseline, incoming, current);
    expect(result.rules).toBe('');
    expect(result.remoteMusicKey).toBeUndefined();
    expect(result.brandName).toBe('Current brand');
  });

  it('returns the current object when a cloned stale snapshot has no actual edits', () => {
    const baseline = settings({ signatureRequests: [signature('ada')] });
    const current = { ...baseline, signatureRequests: [signature('jo'), signature('ada', { signed: receipt })], rules: 'New notes' };
    expect(mergeSettingsEdit(baseline, structuredClone(baseline), current)).toBe(current);
  });

  it('keeps stable references when the incoming edit is already present in current', () => {
    const baseline = settings({ signatureRequests: [signature('ada')] });
    const current = { ...baseline, signatureRequests: [signature('ada', { signed: receipt })] };
    expect(mergeSettingsEdit(baseline, structuredClone(current), current)).toBe(current);
  });

  it('preserves intended insertion and reorder positions while retaining concurrent records', () => {
    const ada = signature('ada');
    const jo = signature('jo');
    const newLink = signature('new');
    const concurrent = signature('concurrent');
    const baseline = settings({ signatureRequests: [ada, jo] });
    const current = { ...baseline, signatureRequests: [concurrent, ada, jo] };
    const result = mergeSettingsEdit(baseline, { ...baseline, signatureRequests: [jo, newLink, ada] }, current);
    expect(result.signatureRequests.map((request) => request.id)).toEqual(['concurrent', 'jo', 'new', 'ada']);
  });

  it('retains concurrent show tombstones while applying explicit membership edits', () => {
    const baseline = settings({ deletedShowIds: ['old'], showTypes: ['Comedy'] });
    const current = { ...baseline, deletedShowIds: ['concurrent', 'old'], showTypes: ['Comedy', 'Music'] };
    const result = mergeSettingsEdit(baseline, { ...baseline, deletedShowIds: ['new', 'old'], showTypes: [] }, current);
    expect(result.deletedShowIds).toEqual(['concurrent', 'new', 'old']);
    expect(result.showTypes).toEqual(['Music']);
  });
});
