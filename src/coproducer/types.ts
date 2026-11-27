// The wire contract between the co-producer's app, the owner's app and
// /api/coproducer. Types and constants only: no DOM, no Node, so api/ imports
// it too (tsconfig.api.json uses verbatimModuleSyntax, so type imports stay
// `import type`). Changed only through the coordinator.
import type { AppSettings, Show } from '../types';

export type RequestKind = 'edit' | 'share' | 'download';
export type RequestStatus = 'pending' | 'stale' | 'approved' | 'rejected' | 'withdrawn';
export const OPEN_STATUSES: readonly RequestStatus[] = ['pending', 'stale'];

export const COPRODUCE_PATH = '/coproduce';
/** A link token: 32 random bytes, base64url, no padding. */
export const COPRODUCER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** The link token rides in the fragment as #t=<token>. */
export const COPRODUCER_FRAGMENT = /[#&]t=([A-Za-z0-9_-]{43})(?=&|$)/;
/** Where the link page's inline script leaves the token it took out of the fragment. */
export const COPRODUCER_TOKEN_GLOBAL = '__icrasCoproduceToken';

/** What a redacted link token looks like to a co-producer. */
export const REDACTED_TOKEN_PREFIX = 'redacted-';
/** Hashed in front of a token to make its pseudonym. Changing it orphans every open request. */
export const PSEUDONYM_LABEL = 'icanrunashow coproducer token v1:';

export const COPRODUCER_LIMITS = {
  linkSeconds: 30 * 24 * 60 * 60,
  maxLinksPerAccount: 20,
  maxOpenRequestsPerLink: 200,
  maxRequestBodyChars: 2_000_000,
  maxOpenRequestBytesPerLink: 50_000_000,
  maxStagedBytesPerLink: 200_000_000,
  maxUnattachedStagedFilesPerLink: 20,
  maxCoproducerBytesPerAccount: 1_000_000_000,
  maxResultChars: 65_536,
  maxHandoutChars: 16_384,
  maxLabelChars: 60,
  maxStageSliceChars: 1_600_000,
  maxStageChunks: 64,
  maxPayloadDepth: 16,
  maxPayloadValues: 100_000,
  maxShowEdits: 100,
  maxSettingsFields: 40,
  maxShareRequestIds: 50,
  showsPageMaxRows: 50,
  showsPageMaxBytes: 8_000_000,
  maxHandoutsPerAccount: 500,
} as const;

// ── Edits ─────────────────────────────────────────────────────────────────
/** Top-level show keys a request may change. The owner's app owns the rest. */
export type ShowKey = Exclude<keyof Show, 'id' | 'createdAt' | 'updatedAt' | 'viewToken' | 'viewerKey'>;
export interface ShowCreate { target: 'show'; op: 'create'; showId: string; show: Show }
/**
 * Only the keys that differ. For each key in `keys`, `base[key]` is its value
 * at truth and `proposed[key]` the value asked for; a key that is not an own
 * property of one side means "unset" on that side. List keys carry the whole
 * list. Nothing outside `keys` is read.
 */
export interface ShowUpdate { target: 'show'; op: 'update'; showId: string; baseRevision: string | null; keys: ShowKey[]; base: Partial<Show>; proposed: Partial<Show> }
export interface ShowDelete { target: 'show'; op: 'delete'; showId: string; baseRevision: string | null; base: Show }
export type ShowEdit = ShowCreate | ShowUpdate | ShowDelete;

export type SettingsKey = keyof AppSettings;
/** Fields a request never carries: the owner's app derives them. */
export const SETTINGS_DERIVED_FIELDS: readonly SettingsKey[] = ['deletedShowIds', 'onboarded'];
/** One top-level settings value. `base`/`proposed` not own properties means unset. */
export interface SettingsValueEdit { field: SettingsKey; kind: 'value'; base?: unknown; proposed?: unknown }
/**
 * A list of records keyed by `idField`. Rows travel as [id, row] pairs, never
 * as an object keyed by id: a row id can be any string, '__proto__' included.
 */
export interface SettingsRowsEdit {
  field: SettingsKey;
  kind: 'rows';
  idField: string;
  baseOrder: string[];
  proposedOrder: string[];
  /** Rows as they were, for rows changed or removed. */
  base: [string, unknown][];
  /** Rows as proposed, for rows changed or added. */
  proposed: [string, unknown][];
}
export type SettingsFieldEdit = SettingsValueEdit | SettingsRowsEdit;
export interface SettingsEdit { target: 'settings'; baseRevision: string | null; fields: SettingsFieldEdit[] }

/** Settings lists edited row by row and the field each row is known by. A Map, so a payload's field name can never reach an inherited property. */
export const SETTINGS_ROW_FIELDS: ReadonlyMap<SettingsKey, string> = new Map<SettingsKey, string>([
  ['producers', 'id'], ['trash', 'id'], ['potentialComics', 'id'], ['expenses', 'id'], ['emailList', 'email'],
  ['scheduleTemplates', 'id'], ['musicLibrary', 'id'], ['contracts', 'id'], ['signedAgreements', 'id'],
  ['signatureRequests', 'token'], ['profileRequests', 'token'],
]);
/** Row lists a request may only remove rows from. */
export const REMOVE_ONLY_ROW_FIELDS: ReadonlySet<SettingsKey> = new Set<SettingsKey>(['trash', 'signatureRequests', 'profileRequests']);

export interface EditPayload { kind: 'edit'; shows: ShowEdit[]; settings: SettingsEdit | null }

// ── Shares ────────────────────────────────────────────────────────────────
// No free-text label or summary anywhere: both apps describe a request from
// its typed fields and their own data (diff.ts headline, describePayload).
export type CopySource = 'announce-post' | 'announce-tags' | 'season-pitch';
export type EmailSource = 'lineup' | 'rolodex-all' | 'person';
export type ShareAction =
  /** Text the app would put on the clipboard; shown to the owner in full. */
  | { type: 'copy-text'; source: CopySource; showId?: string; text: string }
  /** A mailto: link exactly as the app would open it; the owner sees its recipients, subject and body. */
  | { type: 'email'; source: EmailSource; showId?: string; href: string }
  /** Make a new signing link for a contract (the owner's app makes it on approval). */
  | { type: 'signing-link'; contractId: string; signer: { name: string; email?: string; contactId?: string } }
  /** Pass on signing links already sent, by SignatureRequest.id (1-50). */
  | { type: 'existing-signing-link'; requestIds: string[] }
  /** Make a new "Ask for details" link for a Rolodex entry. */
  | { type: 'profile-link'; contactId: string }
  /** Pass on a details link already sent, by ProfileRequest.id. */
  | { type: 'existing-profile-link'; requestId: string }
  /** The show's viewer link: made on approval if the show has none. The note is the show's own viewNote, edited as an ordinary change. */
  | { type: 'viewer-link'; showId: string };
export type ShareType = ShareAction['type'];
export const SHARE_TYPES: readonly ShareType[] = ['copy-text', 'email', 'signing-link', 'existing-signing-link', 'profile-link', 'existing-profile-link', 'viewer-link'];
export interface SharePayload { kind: 'share'; action: ShareAction }

// ── Downloads ─────────────────────────────────────────────────────────────
/** Whose headshot: resolved from the data on each side, never a photo string in the payload. */
export type HeadshotSubject =
  | { kind: 'performer'; showId: string; personId: string }
  | { kind: 'artist'; showId: string; personId: string }
  | { kind: 'contact'; contactId: string };
export type DownloadAction =
  | { type: 'backup' }
  | { type: 'headshot'; subject: HeadshotSubject }
  | { type: 'headshot-pack'; showId: string; includesGuests: boolean }
  | { type: 'flyer'; showId: string }
  | { type: 'signed-agreement'; agreementId: string }
  | { type: 'dj-list-text'; showId: string }
  | { type: 'runsheet-pdf'; showId: string }
  | { type: 'dj-list-pdf'; showId: string };
export type DownloadType = DownloadAction['type'];
export const DOWNLOAD_TYPES: readonly DownloadType[] = ['backup', 'headshot', 'headshot-pack', 'flyer', 'signed-agreement', 'dj-list-text', 'runsheet-pdf', 'dj-list-pdf'];
export interface DownloadPayload { kind: 'download'; action: DownloadAction }

export type RequestPayload = EditPayload | SharePayload | DownloadPayload;

/** Server-derived from the payload when a request is made (outline.ts buildOutline); what lists show. */
export interface RequestOutline {
  kind: RequestKind;
  /** Edits: each show touched, with the name a create proposes (updates and deletes are named from data by id). */
  shows?: { id: string; op: 'create' | 'update' | 'delete'; createName?: string }[];
  settingsFields?: SettingsKey[];
  /** Shares and downloads: the action with any free text removed (copy-text text, email href, signer name and email). */
  action?: { type: ShareType | DownloadType; key: string; showId?: string; contractId?: string; contactId?: string; agreementId?: string; requestIds?: string[]; subject?: HeadshotSubject };
}

/** What an approval hands back. For link shares, the URL the owner's app made or looked up; labels are the owner app's words. */
export interface ApprovalResult { links?: { label: string; url: string }[]; text?: string }
/** What an approved link share handed out, by id (never a token or key). */
export interface HandoutRefs {
  links: ({ kind: 'signature'; requestId: string } | { kind: 'profile'; requestId: string } | { kind: 'viewer'; showId: string })[];
}

// ── Route bodies and answers ──────────────────────────────────────────────
export interface CreateLinkBody { label: string; key: string; legacyKey: string; consent: true }
export interface CoproducerLinkInfo {
  id: string;
  /** CryptoJS AES of the label (a JSON string) under the account key; the owner decrypts it. */
  labelCipher: string;
  createdAt: string;
  expiresAt: string;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
  openRequests: number;
  /** Staged file bytes plus open request bytes. */
  storageBytes: number;
  handouts: number;
}
export interface CreateLinkResponse { link: CoproducerLinkInfo; token: string }

export interface OwnerRequestRow {
  id: string;
  linkId: string;
  kind: RequestKind;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
  usedAt: string | null;
  /** CryptoJS AES of RequestOutline under the account key. */
  outline: string;
  mediaIds: string[];
  bytes: number;
}
export interface OwnerRequestDetail extends OwnerRequestRow {
  /** CryptoJS AES of RequestPayload under the account key. */
  payload: string;
  result: string | null;
}
export interface DecideBody {
  id: string;
  decision: 'approved' | 'rejected' | 'stale';
  /** CryptoJS AES of ApprovalResult; approvals of link shares only. */
  result?: string;
  /** CryptoJS AES of HandoutRefs; approvals that handed out a link only. */
  handout?: string;
}
export interface DecideManyBody { ids: string[]; decision: 'stale' | 'rejected' }
export interface HandoutRow { id: string; linkId: string; labelCipher: string; refsCipher: string; createdAt: string; linkEndedAt: string | null }

export interface CoproducerSessionInfo { link: { id: string; label: string; expiresAt: string }; producerLocked: boolean }
export interface CoproducerShowPage { shows: { show: Show; revision: string }[]; next: string | null; unreadable: number }
export interface CoproducerRevisions { shows: { id: string; revision: string }[]; settings: string | null }
export interface CoproducerSettingsView { settings: AppSettings | null; revision: string | null }
export interface MediaChunk { data: string; total: number }
export interface StageChunkBody { id: string; seq: number; total: number; data: string }
export interface NewRequestBody { kind: RequestKind; payload: RequestPayload; mediaIds: string[] }
export interface CoproducerRequestView {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
  usedAt: string | null;
  outline: RequestOutline;
  result: ApprovalResult | null;
}
export interface CoproducerRequestDetail extends CoproducerRequestView { payload: RequestPayload }

// ── The diff model (built by src/coproducer/diff.ts) ──────────────────────
export type MediaKind = 'image' | 'audio' | 'pdf';
export interface FieldChange {
  /** Machine path in the grammar of paths.ts, e.g. 'venueName', 'performers/p1/email', 'performers/p1', 'performers#order'. */
  key: string;
  /** Where it lives, outermost first, in words: ['Performers', 'Sam Lee']. Empty for a top-level field. */
  path: string[];
  /** The field's name in words: 'Email', 'Venue name', 'Added', 'Removed', 'Order'. */
  label: string;
  /** What is there now, as full text (never cut; ChangeList shortens for display). Null when nothing is. */
  before: string | null;
  /** What is proposed, as full text; null when it would be removed or emptied. */
  after: string | null;
  change: 'added' | 'removed' | 'changed' | 'moved';
  /** Set when the value is a file: media refs or data URLs, for previews of both sides. */
  media?: { kind: MediaKind; before?: string; after?: string };
  /** Set when the value is a web address to open (a tape): each side's http or https URL, checked. */
  link?: { before?: string; after?: string };
}
/** Shares and downloads: the item itself, shown in place of "Now". */
export interface HandOver {
  /** In the reader's own data and words: 'The flyer for “Friday Laughs”'. */
  what: string;
  /** Shown in full: each recipient line, subject, body; each link and its signer; the text to copy. */
  details: { label: string; value: string }[];
  media?: { kind: MediaKind; ref: string };
}
export interface ChangeGroup {
  /** Stable: 'show:<id>', 'settings:workspace', 'settings:<field>', 'share', 'download'. */
  key: string;
  /** In words: the show's name, 'Rolodex', 'Contracts', 'Settings', 'Share', 'Download'. */
  title: string;
  /** Beside the title: 'New show', 'Show deleted', 'Restored'. */
  note?: string;
  changes: FieldChange[];
  /** Share and download groups only. */
  handOver?: HandOver;
}
/** A value the owner changed since the request was made, to something other than proposed. Approving anyway applies theirs. */
export interface Conflict { groupKey: string; key: string; path: string[]; label: string; asked: string | null; now: string | null; proposed: string | null }
/** What the owner's merge finds, on raw values; diff.ts describeConflict turns it into a Conflict. `path` is in the grammar of paths.ts. */
export interface RawConflict { groupKey: string; path: string; base: unknown; current: unknown; proposed: unknown }

// ── The co-producer's client (implemented by src/coproducer/client.ts) ────
export interface CoproducerClient {
  /** GET ?route=session */
  session(): Promise<CoproducerSessionInfo>;
  /** GET ?route=shows, paging by size */
  showsPage(after?: string): Promise<CoproducerShowPage>;
  /** GET ?route=shows&ids=…, at most 50 per call */
  showsByIds(ids: string[]): Promise<CoproducerShowPage>;
  /** GET ?route=revisions */
  revisions(): Promise<CoproducerRevisions>;
  /** GET ?route=settings */
  settings(): Promise<CoproducerSettingsView>;
  /** GET ?route=media, timeout MEDIA_CHUNK_TIMEOUT_MS */
  mediaChunk(id: string, seq: number): Promise<MediaChunk>;
  /** GET ?route=profile-photo */
  profilePhotoChunk(requestId: string, seq: number): Promise<MediaChunk>;
  /** PUT ?route=stage, timeout MEDIA_CHUNK_TIMEOUT_MS */
  stageChunk(body: StageChunkBody): Promise<void>;
  /** POST ?route=requests */
  createRequest(body: NewRequestBody): Promise<CoproducerRequestView>;
  /** GET ?route=requests */
  listRequests(): Promise<CoproducerRequestView[]>;
  /** GET ?route=requests&id=… */
  getRequest(id: string): Promise<CoproducerRequestDetail>;
  /** DELETE ?route=requests&id=… */
  withdraw(id: string): Promise<void>;
  /** POST ?route=use */
  markUsed(id: string): Promise<void>;
}
