import { describe, expect, it } from 'vitest';
import type { PotentialComic, SignatureRequest } from '../types';
import { fileSignedHeadshots } from './signedHeadshots';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const request = (over: Partial<SignatureRequest> & { signerName: string }): SignatureRequest => ({
  id: over.signerName, token: `token-${over.signerName}`, key: 'k', contractId: 'c', contractName: 'Agreement',
  sentAt: '2026-09-01T00:00:00Z', ...over,
} as SignatureRequest);

const comic = (over: Partial<PotentialComic>): PotentialComic => ({ id: 'c', name: '', ...over });

describe('filing the headshot that came back with a signature', () => {
  it('puts it in the store and on the person when they had no picture', async () => {
    const uploads: string[] = [];
    const upload = async (file: File) => { uploads.push(file.name); return `media:${uploads.length}#1`; };
    const result = await fileSignedHeadshots(
      [request({ signerName: 'Nadia Okonjo', contactId: 'nadia', signed: { signedAt: '', typedName: 'Nadia', documentHash: 'h', fields: [], headshot: PNG } })],
      [comic({ id: 'nadia', name: 'Nadia Okonjo' })],
      upload,
    );
    expect(uploads).toEqual(['Nadia Okonjo.jpg']);
    expect(result?.potentialComics[0].photo).toBe('media:1#1');
    expect(result?.signatureRequests[0].signed?.headshot).toBe('media:1#1');
  });

  it('keeps the photo the producer already chose, but files theirs so it can be offered', async () => {
    const result = await fileSignedHeadshots(
      [request({ signerName: 'Nadia Okonjo', contactId: 'nadia', signed: { signedAt: '', typedName: 'Nadia', documentHash: 'h', fields: [], headshot: PNG } })],
      [comic({ id: 'nadia', name: 'Nadia Okonjo', photo: 'media:chosen#1' })],
      async () => 'media:sent#1',
    );
    expect(result?.potentialComics[0].photo).toBe('media:chosen#1');
    // The data URL has left the settings blob; the offer can show the stored copy.
    expect(result?.signatureRequests[0].signed?.headshot).toBe('media:sent#1');
  });

  it('leaves a photo that would not upload on the record for the next try', async () => {
    const result = await fileSignedHeadshots(
      [request({ signerName: 'Nadia Okonjo', contactId: 'nadia', signed: { signedAt: '', typedName: 'Nadia', documentHash: 'h', fields: [], headshot: PNG } })],
      [comic({ id: 'nadia', name: 'Nadia Okonjo' })],
      async () => { throw new Error('venue wifi'); },
    );
    expect(result).toBeNull();
  });

  it('does nothing when every headshot is already filed', async () => {
    const result = await fileSignedHeadshots(
      [request({ signerName: 'Nadia Okonjo', contactId: 'nadia', signed: { signedAt: '', typedName: 'Nadia', documentHash: 'h', fields: [], headshot: 'media:done#1' } })],
      [comic({ id: 'nadia', name: 'Nadia Okonjo', photo: 'media:done#1' })],
      async () => { throw new Error('must not upload'); },
    );
    expect(result).toBeNull();
  });
});
