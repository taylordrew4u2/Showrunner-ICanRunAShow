import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings, type SignatureRequest } from '../types';
import { normalizeComicSettings } from './sharedComicSettings';

const request = (patch: Partial<SignatureRequest> = {}): SignatureRequest => ({
  id: 'r', token: 'token', key: 'key', contractId: 'contract', contractName: 'Agreement',
  signerName: 'Mona Sable', sentAt: '2026-09-15', ...patch,
});
const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({
  ...DEFAULT_SETTINGS, potentialComics: [{ id: 'comic', name: 'Mona Sable' }], signatureRequests: [], ...patch,
});

describe('canonical comic settings', () => {
  it('binds legacy paperwork before a rename without changing the signed snapshot', () => {
    const signed = { typedName: 'Mona Sable', signedAt: '2026-09-15', documentHash: 'hash' };
    const before = settings({ signatureRequests: [request({ signed })] });
    const after = normalizeComicSettings({ ...before, potentialComics: [{ id: 'comic', name: 'Mona Rose' }] }, before);
    expect(after.signatureRequests[0]).toMatchObject({ contactId: 'comic', signerName: 'Mona Sable' });
    expect(after.signatureRequests[0].signed).toBe(signed);
    expect(after.potentialComics).toHaveLength(1);
    expect(after.potentialComics[0].name).toBe('Mona Rose');
  });

  it('fills signed answers once, then preserves a deliberately cleared field', () => {
    const before = settings({ signatureRequests: [request({ signed: {
      typedName: 'Mona Sable', signedAt: '2026-09-15', documentHash: 'hash',
      fields: [{ label: 'Email', value: 'mona@example.com' }],
    } })] });
    const filed = normalizeComicSettings(before, before);
    expect(filed.potentialComics[0].email).toBe('mona@example.com');
    expect(filed.signatureRequests[0].profileFiled).toBe(true);
    const cleared = { ...filed, potentialComics: [{ ...filed.potentialComics[0], email: undefined }] };
    expect(normalizeComicSettings(cleared, filed).potentialComics[0].email).toBeUndefined();
    // A stale signature refresh must not erase the import marker.
    const refreshed = normalizeComicSettings({ ...cleared, signatureRequests: before.signatureRequests }, cleared);
    expect(refreshed.potentialComics[0].email).toBeUndefined();
  });

  it('does not reassign an explicit contact to a same-named different comic', () => {
    const before = settings({ signatureRequests: [request({ contactId: 'removed' })] });
    const after = normalizeComicSettings(before, before);
    expect(after.signatureRequests[0].contactId).toBe('removed');
    expect(after.potentialComics).toBe(before.potentialComics);
  });

  it('does not bind ambiguous legacy names', () => {
    const before = settings({ potentialComics: [{id:'a',name:'Mona Sable'}, {id:'b',name:'Mona Sable'}], signatureRequests:[request()] });
    expect(normalizeComicSettings(before, before).signatureRequests[0].contactId).toBeUndefined();
  });

  it('keeps an unchanged settings reference stable', () => {
    const before = settings();
    expect(normalizeComicSettings(before, before)).toBe(before);
  });
});
