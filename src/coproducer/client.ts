/**
 * The co-producer's side of /api/coproducer.
 *
 * Every call carries the link's token as a bearer and nothing else: never
 * x-user-id or x-auth, which are the owner's, and never a key. What comes
 * back is already redacted and decrypted by the server, so there is nothing
 * here to decrypt with, and the one thing this side writes is a request.
 */
import { api, type ApiError } from '../utils/api';
import { MEDIA_CHUNK_TIMEOUT_MS, type ReviewMediaSource } from '../utils/mediaStore';
import {
  COPRODUCER_LIMITS,
  type CoproducerClient,
  type CoproducerRequestDetail,
  type CoproducerRequestView,
  type CoproducerRevisions,
  type CoproducerSessionInfo,
  type CoproducerSettingsView,
  type CoproducerShowPage,
  type MediaChunk,
} from './types';

const ROUTE = '/api/coproducer?route=';

export type LinkEndedCode = 'link_ended' | 'link_unreadable';

let endedListener: ((code: LinkEndedCode) => void) | null = null;
let told = false;

/**
 * Told once when any call answers 410: the owner withdrew the link, it
 * expired, or it can no longer open the account. Nothing after that can
 * work, so the app swaps itself for a screen that says so.
 */
export function onLinkEnded(listener: ((code: LinkEndedCode) => void) | null): void {
  endedListener = listener;
  told = false;
}

function noticeEnded(err: unknown): void {
  const e = err as ApiError | null;
  if (e?.status !== 410 || told || !endedListener) return;
  told = true;
  endedListener(e.code === 'link_unreadable' ? 'link_unreadable' : 'link_ended');
}

async function watched<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (err) {
    noticeEnded(err);
    throw err;
  }
}

export function createCoproducerClient(token: string): CoproducerClient {
  const auth = { bearer: token };
  const get = <T>(path: string, timeoutMs?: number) =>
    watched(() => api.get<T>(`${ROUTE}${path}`, timeoutMs === undefined ? auth : { ...auth, timeoutMs }));

  return {
    session: () => get<CoproducerSessionInfo>('session'),
    showsPage: (after) => get<CoproducerShowPage>(after === undefined ? 'shows' : `shows&after=${encodeURIComponent(after)}`),
    showsByIds: async (ids) => {
      if (ids.length === 0) return { shows: [], next: null, unreadable: 0 };
      if (ids.length > COPRODUCER_LIMITS.showsPageMaxRows) {
        throw new Error(`At most ${COPRODUCER_LIMITS.showsPageMaxRows} shows at a time.`);
      }
      return get<CoproducerShowPage>(`shows&ids=${ids.map(encodeURIComponent).join(',')}`);
    },
    revisions: () => get<CoproducerRevisions>('revisions'),
    settings: () => get<CoproducerSettingsView>('settings'),
    mediaChunk: (id, seq) => get<MediaChunk>(`media&id=${encodeURIComponent(id)}&seq=${seq}`, MEDIA_CHUNK_TIMEOUT_MS),
    profilePhotoChunk: (requestId, seq) =>
      get<MediaChunk>(`profile-photo&request=${encodeURIComponent(requestId)}&seq=${seq}`, MEDIA_CHUNK_TIMEOUT_MS),
    stageChunk: async (body) => {
      await watched(() => api.put(`${ROUTE}stage`, body, { ...auth, timeoutMs: MEDIA_CHUNK_TIMEOUT_MS }));
    },
    createRequest: async (body) =>
      (await watched(() => api.post<{ request: CoproducerRequestView }>(`${ROUTE}requests`, body, auth))).request,
    listRequests: async () => (await get<{ requests: CoproducerRequestView[] }>('requests')).requests,
    getRequest: async (id) =>
      (await get<{ request: CoproducerRequestDetail }>(`requests&id=${encodeURIComponent(id)}`)).request,
    withdraw: async (id) => {
      await watched(() => api.del(`${ROUTE}requests&id=${encodeURIComponent(id)}`, auth));
    },
    markUsed: async (id) => {
      await watched(() => api.post(`${ROUTE}use`, { id }, auth));
    },
  };
}

/** The media store's source of files in co-producer view: plaintext slices to read, and staging for new ones. */
export function reviewMediaSource(client: CoproducerClient): ReviewMediaSource {
  return {
    chunk: async (id, seq) => {
      const { data } = await client.mediaChunk(id, seq);
      if (typeof data !== 'string') throw new Error('That file could not be read.');
      return data;
    },
    stage: (body) => client.stageChunk(body),
  };
}
