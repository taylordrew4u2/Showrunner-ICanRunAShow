// What every helper does once the app is showing a co-producer the owner's
// account (spec e.5, the U rows): with fetch mocked, nothing but the
// co-producer route is ever written to, and nothing is handed over without
// an approval. The first block checks the same helpers in the owner's app,
// before co-producer view is entered (it is never left within a page).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileRequest, SignatureRequest } from '../types';
import { api, withNetworkRetry } from '../utils/api';
import { revokeSignature, refreshSignatures, sendForSignature, signingUrl } from '../utils/contracts';
import { deliverFile } from '../utils/download';
import { decryptWithKeys, encryptWithKey } from '../utils/encryption';
import { shareHeadshots } from '../utils/headshotExport';
import { ensureViewerKey, publishTrack, unpublishAll, viewerUrl } from '../utils/viewerAudio';
import { livePublisher, publishLiveView, withdrawLiveView } from '../utils/liveView';
import { sweepUnusedMedia } from '../utils/mediaCleanup';
import {
  clearMediaStore,
  deleteMedia,
  initMediaStore,
  onStagingChange,
  resolveMediaUrl,
  stagedMediaIdSet,
  stagingInFlight,
  uploadMedia,
} from '../utils/mediaStore';
import { openPrintable } from '../utils/pdfExport';
import {
  createProfileLink,
  deleteProfilePhoto,
  fetchProfilePhoto,
  profileUrl,
  refreshProfiles,
  revokeProfileLink,
} from '../utils/profileLink';
import { exportUserData, heldCopyLock, parkSettingsSnapshot, saveEncryptedSettings, saveEncryptedShows } from '../utils/secure-storage';
import { fileSignedHeadshots } from '../utils/signedHeadshots';
import { disconnectChatGPT, grantChatGPTAccess, revokeChatGPTConnection } from '../utils/chatgpt';
import type { SessionCredentials } from '../utils/session-vault';
import { createCoproducerClient } from './client';
import { copyText, shareLink, withApprovedDelivery } from './gates';
import { enterReviewMode, getReviewSession, isReviewMode, makeReviewSession, ReviewModeBlockedError } from './reviewMode';
import { DEFAULT_SETTINGS } from '../types';

const OWNER: SessionCredentials = { username: 'owner', userId: 'u1', authHash: 'h1', key: 'k'.repeat(64), legacyKey: 'l'.repeat(64) };
const TOKEN = 'C'.repeat(43);

const signature: SignatureRequest = {
  id: 'sigtoken1234', token: 'sigtoken1234567890', key: 'signkey', contractId: 'ct1', contractName: 'Agreement',
  signerName: 'Sam', sentAt: '2026-01-01T00:00:00.000Z',
};
const profile: ProfileRequest = {
  id: 'protoken1234', token: 'protoken1234567890', key: 'profkey', personName: 'Sam', sentAt: '2026-01-01T00:00:00.000Z',
  submitted: { submittedAt: 'x', typedName: 'Sam', fields: [], photoChunks: 2 },
};

/** Every request the page makes. */
let fetchMock: ReturnType<typeof vi.fn>;
function answer(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response;
}
const sent = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: (init as RequestInit)?.method ?? 'GET', headers: (init as RequestInit)?.headers as Record<string, string> }));
const writes = () => sent().filter((r) => r.method !== 'GET');

/** A FileReader for node, reading a File as the browser would. */
class FakeFileReader {
  result: string | null = null;
  error: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(file: File) {
    void file.arrayBuffer().then((buffer) => {
      this.result = `data:${file.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onload?.();
    });
  }
}

beforeEach(() => {
  fetchMock = vi.fn(async () => answer({ ok: true, shows: [], items: [], data: 'x', total: 1 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { origin: 'https://showrunner-theta.vercel.app', protocol: 'https:', hostname: 'showrunner-theta.vercel.app' });
  vi.stubGlobal('FileReader', FakeFileReader);
});

afterAll(() => {
  vi.unstubAllGlobals();
  clearMediaStore();
});

describe('in the owner’s app', () => {
  it('is not co-producer view', () => {
    expect(isReviewMode()).toBe(false);
    expect(getReviewSession()).toBeNull();
  });

  it('withdraws, deletes and builds links as before', async () => {
    initMediaStore(OWNER);
    await revokeSignature(signature, OWNER);
    deleteMedia('media:abcdefgh-0000#1');
    await withdrawLiveView('view-token', OWNER);
    expect(writes().map((r) => `${r.method} ${r.url.split('?')[0]}`)).toEqual([
      'DELETE /api/sign', 'DELETE /api/sign-doc', 'DELETE /api/media', 'DELETE /api/live',
    ]);
    expect(signingUrl('https://icanrunashow.com', 'tok', 'key')).toBe('https://icanrunashow.com/sign?t=tok#k=key');
    expect(profileUrl('https://icanrunashow.com', 'tok', 'key')).toContain('#k=key');
    expect(viewerUrl('https://icanrunashow.com', 'tok', 'key')).toContain('#k=key');
  });

  it('hands files over without asking', async () => {
    vi.stubGlobal('window', {});
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
    expect(await deliverFile(new Blob(['x']), 'a.json')).toBe('downloaded');
    expect(link.click).toHaveBeenCalled();
  });

  it('refuses no key but an empty one', () => {
    expect(() => encryptWithKey('x', '')).toThrow();
    expect(() => decryptWithKeys(encryptWithKey('x', OWNER.key), [OWNER.key, ''])).toThrow();
    expect(decryptWithKeys(encryptWithKey('x', OWNER.key), [OWNER.key, OWNER.legacyKey])).toBe('x');
    expect(() => heldCopyLock({ ...OWNER, key: '' })).toThrow();
    expect(() => heldCopyLock(OWNER)).not.toThrow();
  });
});

describe('in co-producer view', () => {
  let review: ReturnType<typeof makeReviewSession>;

  beforeAll(() => {
    clearMediaStore();
    const client = createCoproducerClient(TOKEN);
    review = makeReviewSession(TOKEN, { link: { id: 'link-1', label: 'Sam', expiresAt: '2026-12-01T00:00:00.000Z' }, producerLocked: false }, client);
    vi.stubGlobal('document', { documentElement: { classList: { add: vi.fn() } } });
    enterReviewMode(review);
  });

  it('runs on stand-in credentials that open nothing', () => {
    expect(isReviewMode()).toBe(true);
    expect(review.credentials).toEqual({ username: 'coproducer:link-1', userId: '', authHash: '', key: '', legacyKey: '' });
  });

  it('refuses every write but the co-producer route, before fetch, and never retries it', async () => {
    const refused = [
      () => api.put('/api/shows', {}),
      () => api.post('/api/settings', {}),
      () => api.patch('/api/media', {}),
      () => api.del('/api/media?id=x'),
      () => api.post('/api/coproducerX', {}),
      () => api.post('/api/coproducer/../shows', {}),
      () => api.post('https://elsewhere.example/api/coproducer?route=requests', {}),
    ];
    for (const write of refused) await expect(write()).rejects.toMatchObject({ status: 0, code: 'review_mode' });
    const attempt = vi.fn(() => api.put('/api/shows', {}));
    await expect(withNetworkRetry(attempt)).rejects.toMatchObject({ code: 'review_mode' });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    await api.get('/api/shows');
    await api.post('/api/coproducer?route=requests', {});
    expect(sent().map((r) => `${r.method} ${r.url}`)).toEqual(['GET /api/shows', 'POST /api/coproducer?route=requests']);
  });

  it('never saves, parks or exports the account', async () => {
    await expect(saveEncryptedShows([], review.credentials)).rejects.toBeInstanceOf(ReviewModeBlockedError);
    await expect(saveEncryptedSettings(DEFAULT_SETTINGS, review.credentials)).rejects.toBeInstanceOf(ReviewModeBlockedError);
    await expect(parkSettingsSnapshot(DEFAULT_SETTINGS, review.credentials)).rejects.toBeInstanceOf(ReviewModeBlockedError);
    await expect(exportUserData(review.credentials)).rejects.toBeInstanceOf(ReviewModeBlockedError);
    expect(() => heldCopyLock(review.credentials)).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns link making into an error and link withdrawing into nothing', async () => {
    await expect(sendForSignature({ id: 'ct1', name: 'A', fileRef: 'media:x#1', fileName: 'a.pdf', sizeBytes: 1, uploadedAt: 'x', fields: [] }, { name: 'Sam' }, 'Brand', review.credentials))
      .rejects.toBeInstanceOf(ReviewModeBlockedError);
    await expect(createProfileLink({ name: 'Sam' }, 'Brand', review.credentials)).rejects.toBeInstanceOf(ReviewModeBlockedError);
    await expect(publishLiveView('tok', { status: 'idle' } as never, review.credentials)).rejects.toBeInstanceOf(ReviewModeBlockedError);
    await expect(publishTrack('tok', 'key', 'media:x#1', 'm', review.credentials)).rejects.toBeInstanceOf(ReviewModeBlockedError);
    await expect(sweepUnusedMedia([], DEFAULT_SETTINGS, review.credentials)).rejects.toBeInstanceOf(ReviewModeBlockedError);
    await expect(grantChatGPTAccess(review.credentials, {} as never, [])).rejects.toBeInstanceOf(ReviewModeBlockedError);
    await expect(disconnectChatGPT(review.credentials)).rejects.toBeInstanceOf(ReviewModeBlockedError);
    await expect(revokeChatGPTConnection(review.credentials, 'c')).rejects.toBeInstanceOf(ReviewModeBlockedError);

    await revokeSignature(signature, review.credentials);
    await revokeProfileLink(profile, review.credentials);
    await deleteProfilePhoto(profile, review.credentials);
    await withdrawLiveView('tok', review.credentials);
    await unpublishAll('tok', review.credentials);
    deleteMedia('media:abcdefgh-0000#1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never looks for replies or files headshots, and builds no link', async () => {
    expect(await refreshSignatures([signature])).toBeNull();
    expect(await refreshProfiles([{ ...profile, submitted: undefined }])).toBeNull();
    expect(await fileSignedHeadshots([signature], [], async () => 'media:x#1')).toBeNull();
    expect(signingUrl('https://x', 'tok', 'key')).toBe('');
    expect(profileUrl('https://x', 'tok', 'key')).toBe('');
    expect(viewerUrl('https://x', 'tok', 'key')).toBe('');
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
    expect(ensureViewerKey('tok')).toBe('');
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs the board without telling the room', () => {
    const publisher = livePublisher('tok');
    const listener = vi.fn();
    publisher.subscribe(listener);
    publisher.publish({ status: 'live' } as never, review.credentials);
    expect(publisher.last()).toBeNull();
    expect(listener).toHaveBeenCalledWith(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads files and profile photos as the server opens them', async () => {
    fetchMock.mockImplementation(async (url: string) => answer({ data: url.includes('seq=0') ? 'data:image/png;base64,AA' : 'BB', total: 2 }));
    expect(await resolveMediaUrl('media:abcdefgh-1111#2')).toBe('data:image/png;base64,AABB');
    expect(await fetchProfilePhoto(profile, review.credentials)).toBe('data:image/png;base64,AABB');
    const urls = sent().map((r) => r.url);
    expect(urls).toContain('/api/coproducer?route=media&id=abcdefgh-1111&seq=0');
    expect(urls).toContain(`/api/coproducer?route=profile-photo&request=${profile.id}&seq=1`);
    for (const r of sent()) {
      expect(r.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(r.headers['x-auth']).toBeUndefined();
    }
  });

  it('stages an upload by what its bytes are, and refuses what is not a photo, audio or PDF', async () => {
    const counts: number[] = [];
    const stop = onStagingChange(() => counts.push(stagingInFlight()));
    // An .m4a a browser labels video/mp4.
    const m4a = new File([new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])], 'walk.m4a', { type: 'video/mp4' });
    const ref = await uploadMedia(m4a);
    expect(ref).toMatch(/^media:[0-9a-f-]{36}#1$/);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/coproducer?route=stage');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string) as { id: string; seq: number; total: number; data: string };
    expect(body.data.startsWith('data:audio/mp4;base64,')).toBe(true);
    expect(stagedMediaIdSet().has(body.id)).toBe(true);
    expect(await resolveMediaUrl(ref)).toBe(body.data);
    expect(counts).toEqual([1, 0]);

    const svg = new File(['<svg onload="alert(1)"></svg>'], 'x.png', { type: 'image/png' });
    await expect(uploadMedia(svg)).rejects.toMatchObject({ reason: 'unsupported_media' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stagingInFlight()).toBe(0);
    stop();
  });

  it('holds back clipboard, share sheet, downloads and printing until an approval hands them over', async () => {
    const writeText = vi.fn(async () => {});
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText }, share, canShare: () => true });
    const printed = { document: { write: vi.fn(), close: vi.fn() }, print: vi.fn() };
    const open = vi.fn(() => printed);
    vi.stubGlobal('window', { open });
    await expect(copyText('x')).rejects.toBeInstanceOf(ReviewModeBlockedError);
    await expect(shareLink('t', 'https://x')).rejects.toBeInstanceOf(ReviewModeBlockedError);
    expect(await deliverFile(new Blob(['x']), 'a.json')).toBe('failed');
    expect(await shareHeadshots([new File(['x'], 'a.jpg')])).toBe('failed');
    openPrintable('<p>x</p>');
    expect(open).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();

    await withApprovedDelivery(() => copyText('approved'));
    expect(writeText).toHaveBeenCalledWith('approved');
    expect(await withApprovedDelivery(() => shareHeadshots([new File(['x'], 'a.jpg')]))).toBe('shared');
    withApprovedDelivery(() => openPrintable('<p>x</p>'));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
