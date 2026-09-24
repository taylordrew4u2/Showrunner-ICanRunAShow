import { describe, expect, it } from 'vitest';
import type { PotentialComic, SignatureRequest } from '../types';
import { filedImportPatch, isPdfFile, linkStillLive, pendingImportFor } from './Contracts';

const signed = (over: Partial<SignatureRequest> & { signerName: string }): SignatureRequest => ({
  id: over.signerName, token: `token-${over.signerName}`, key: 'k', contractId: 'c', contractName: 'Agreement',
  sentAt: '2026-09-01T00:00:00Z',
  signed: { signedAt: '2026-09-02T00:00:00Z', typedName: over.signerName, documentHash: 'h', fields: [] },
  ...over,
} as SignatureRequest);

const comic = (over: Partial<PotentialComic> & { id: string; name: string }): PotentialComic => over;

const none = new Set<string>();

describe('offering what a signed contract brought in', () => {
  it('stops offering a headshot once it is the one on their profile', () => {
    const request = signed({ signerName: 'Ada', contactId: 'ada' });
    request.signed!.headshot = 'media:sent#1';
    const { headshot } = pendingImportFor(request, [comic({ id: 'ada', name: 'Ada', photo: 'media:sent#1' })], none);
    expect(headshot).toBeUndefined();
  });

  it('still offers a headshot that differs from the one on their profile', () => {
    const request = signed({ signerName: 'Ada', contactId: 'ada' });
    request.signed!.headshot = 'media:sent#1';
    const { headshot } = pendingImportFor(request, [comic({ id: 'ada', name: 'Ada', photo: 'media:chosen#1' })], none);
    expect(headshot).toBe('media:sent#1');
  });

  it('leaves out a headshot the producer skipped', () => {
    const request = signed({ signerName: 'Ada', contactId: 'ada' });
    request.signed!.headshot = 'media:sent#1';
    const { headshot } = pendingImportFor(request, [comic({ id: 'ada', name: 'Ada' })], new Set(['token-Ada:photo']));
    expect(headshot).toBeUndefined();
  });
});

describe('adding a signer whose Rolodex entry is gone', () => {
  it('links the contract to the entry it just made, so the offer does not come back', () => {
    // Sent to Ada's entry, which was deleted (here or on another device) before she signed.
    const request = signed({
      signerName: 'Ada', contactId: 'dead',
      signed: { signedAt: '', typedName: 'Ada', documentHash: 'h', fields: [{ label: 'Phone', value: '555 0142' }] },
    });
    const { entry, changes } = pendingImportFor(request, [], none);
    expect(entry).toBeNull();

    const patch = filedImportPatch({ potentialComics: [], signatureRequests: [request] }, request, entry, changes, undefined, () => 'new-ada');
    expect(patch.potentialComics).toEqual([{ id: 'new-ada', name: 'Ada', phone: '555 0142' }]);
    expect(patch.signatureRequests[0].contactId).toBe('new-ada');

    // A second look finds the entry, so pressing again cannot make another Ada.
    const again = pendingImportFor(patch.signatureRequests[0], patch.potentialComics, none);
    expect(again.entry?.id).toBe('new-ada');
    expect(again.changes).toEqual([]);
  });

  it('puts a headshot it had to upload itself on the record, so the offer stands down', () => {
    const request = signed({ signerName: 'Ada', contactId: 'ada' });
    request.signed!.headshot = 'data:image/jpeg;base64,AAAA';
    const comics = [comic({ id: 'ada', name: 'Ada' })];
    const { entry, changes } = pendingImportFor(request, comics, none);
    const patch = filedImportPatch({ potentialComics: comics, signatureRequests: [request] }, request, entry, changes, 'media:face#1', () => 'unused');
    expect(patch.potentialComics[0].photo).toBe('media:face#1');
    expect(patch.signatureRequests[0].signed?.headshot).toBe('media:face#1');
    expect(pendingImportFor(patch.signatureRequests[0], patch.potentialComics, none).headshot).toBeUndefined();
  });

  it('writes accepted details onto an entry that still exists without touching the request', () => {
    const request = signed({
      signerName: 'Ada', contactId: 'ada',
      signed: { signedAt: '', typedName: 'Ada', documentHash: 'h', fields: [{ label: 'Phone', value: '555 0142' }] },
    });
    const comics = [comic({ id: 'ada', name: 'Ada' })];
    const { entry, changes } = pendingImportFor(request, comics, none);
    const patch = filedImportPatch({ potentialComics: comics, signatureRequests: [request] }, request, entry, changes, 'media:face#1', () => 'unused');
    expect(patch.potentialComics).toEqual([{ id: 'ada', name: 'Ada', phone: '555 0142', photo: 'media:face#1' }]);
    expect(patch.signatureRequests[0]).toBe(request);
  });
});

describe('withdrawing a link on a bad connection', () => {
  it('keeps the link on the list when the server never answered', () => {
    expect(linkStillLive(new Error('The operation was aborted'))).toBe(true);
    expect(linkStillLive(Object.assign(new Error('Request failed (500)'), { status: 500 }))).toBe(true);
  });

  it('lets the link go when the server says it is already gone', () => {
    expect(linkStillLive(Object.assign(new Error('not_found'), { status: 404 }))).toBe(false);
  });
});

describe('picking a contract to upload', () => {
  it('accepts a PDF whose type the phone left blank', () => {
    expect(isPdfFile({ type: '', name: 'agreement.pdf' })).toBe(true);
    expect(isPdfFile({ type: 'application/x-pdf', name: 'agreement' })).toBe(true);
    expect(isPdfFile({ type: 'application/pdf', name: 'anything' })).toBe(true);
  });

  it('still refuses a document that is not a PDF', () => {
    expect(isPdfFile({ type: 'application/msword', name: 'agreement.doc' })).toBe(false);
    expect(isPdfFile({ type: '', name: 'agreement.docx' })).toBe(false);
  });
});
