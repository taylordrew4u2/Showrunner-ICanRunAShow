// What every AI assistant tool (Claude or ChatGPT, through /api/mcp) shares:
// the delegated grant, argument checks that do not trust a tool schema, and
// the one way shows and settings are read and written.
//
// Reads decrypt with the delegated keys; writes encrypt under the current key
// and go through the same compare-and-swap and backup path the browser uses
// (applyShowChanges / applySettingsWrite), so a change made here looks to the
// app exactly like one made on another device. Nothing here logs: errors are
// AssistantToolError with a message written for the producer, or a plain
// Error that /api/mcp turns into a generic refusal.
import type { Client } from '@libsql/client';
import type { AppSettings, Show } from '../../src/types';
import { decryptShow, encryptShow } from './chatgptCipher';
import { applySettingsWrite } from './settingsWrites';
import { applyShowChanges, cipherHash } from './showWrites';

export type AssistantScope =
  | 'shows:read' | 'shows:write' | 'shows:delete'
  | 'rolodex:read' | 'rolodex:write'
  | 'contracts:read' | 'links:send';

export interface AssistantGrant {
  userId: string;
  key: string;
  legacyKey?: string;
  scope: string;
}

export interface AssistantContext {
  db: Client;
  grant: AssistantGrant;
  /** The app's own origin, for the links tools hand back. */
  origin: string;
}

/** A refusal whose message is safe and useful to show the producer. */
export class AssistantToolError extends Error {}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The shape of structuredContent; attached from assistantOutputs in assistantTools. */
  outputSchema?: Record<string, unknown>;
  /** `title` repeats the tool's own title, for clients on protocols older than
   * 2025-06-18 that read it only here; assistantTools fills it in. */
  annotations: { title?: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

export interface AssistantTool {
  scope: AssistantScope;
  definition: ToolDefinition;
  run(ctx: AssistantContext, input: unknown): Promise<unknown>;
}

/**
 * The app refuses to send a show or a settings blob larger than this, because
 * the host rejects request bodies past ~4.5 MB (MAX_SAVE_BYTES in
 * src/utils/secure-storage.ts). Writing one here would leave the browser
 * unable to save it again.
 */
export const MAX_SAVE_BYTES = 4_300_000;

export function hasScope(grant: AssistantGrant, scope: AssistantScope): boolean {
  return grant.scope.split(' ').includes(scope);
}

/** A call refused because the connection was not granted the permission it needs. */
export class MissingScopeError extends AssistantToolError {
  readonly scope: AssistantScope;
  constructor(scope: AssistantScope) {
    super(`This connection needs ${scope} permission.`);
    this.scope = scope;
  }
}

export function requireScope(grant: AssistantGrant, scope: AssistantScope): void {
  if (!hasScope(grant, scope)) throw new MissingScopeError(scope);
}

// ── Arguments ───────────────────────────────────────────────────────────────
// Tool schemas are advice to the model, not a guarantee. Every value is checked
// again here before it goes near a show.

export function args(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AssistantToolError('Arguments must be an object.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.includes(key))) throw new AssistantToolError('Unsupported argument.');
  return record;
}

export function showId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new AssistantToolError('A valid show id is required.');
  return value;
}

/** Ids inside a show or the Rolodex. Older ones were not always UUIDs. */
export function itemId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw new AssistantToolError(`A valid ${what} id is required.`);
  return value;
}

export function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new AssistantToolError('Read get_show first and supply its expected_revision.');
  return value;
}

/** Destructive and outward-facing tools act only once the producer has said yes. */
export function confirmed(value: unknown): void {
  if (value !== true) throw new AssistantToolError('Ask the producer first, then call again with confirm: true.');
}

function hasControlCharacters(value: string): boolean {
  return [...value].some(character => {
    const code = character.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  });
}

/** A string within `max`, or undefined when the argument was not given. */
export function text(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max || hasControlCharacters(value)) throw new AssistantToolError(`Invalid ${label}.`);
  return value;
}

/** A string that must have something in it once trimmed. */
export function requiredText(value: unknown, label: string, max: number): string {
  const result = text(value, label, max);
  if (result === undefined || !result.trim()) throw new AssistantToolError(`${label[0].toUpperCase()}${label.slice(1)} is required.`);
  return result.trim();
}

export function bool(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new AssistantToolError(`Invalid ${label}.`);
  return value;
}

export function integer(value: unknown, label: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new AssistantToolError(`${label[0].toUpperCase()}${label.slice(1)} must be a whole number from ${min} to ${max}.`);
  return value;
}

/** Money and counts typed into the app: a finite number, never negative. */
export function amount(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9) throw new AssistantToolError(`Invalid ${label}.`);
  return value;
}

/** An HTTPS link the producer gave, or empty to clear one. */
export function httpsLink(value: unknown, label: string): string | undefined {
  const link = text(value, label, 2048);
  if (!link) return link;
  let url: URL;
  try { url = new URL(link); } catch { throw new AssistantToolError(`${label[0].toUpperCase()}${label.slice(1)} must be an HTTPS URL or empty.`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new AssistantToolError(`${label[0].toUpperCase()}${label.slice(1)} must be an HTTPS URL or empty.`);
  return link;
}

// ── Shows ───────────────────────────────────────────────────────────────────

export interface LoadedShow {
  show: Show;
  cipher: string;
  revision: string;
}

async function decode(ciphertext: string, grant: AssistantGrant): Promise<Show> {
  try {
    const show = await decryptShow<Show>(ciphertext, [grant.key, ...(grant.legacyKey ? [grant.legacyKey] : [])]);
    if (!show || typeof show !== 'object' || typeof show.id !== 'string' || typeof show.name !== 'string') throw new Error('Invalid show');
    return show;
  } catch {
    throw new AssistantToolError('This show could not be read. Disconnect and reconnect the account.');
  }
}

export async function decodeShow(ciphertext: string, id: string, grant: AssistantGrant): Promise<Show> {
  const show = await decode(ciphertext, grant);
  if (show.id !== id) throw new AssistantToolError('This show could not be read.');
  return show;
}

export async function loadShow(ctx: AssistantContext, id: string): Promise<LoadedShow> {
  const rows = await ctx.db.execute({ sql: 'SELECT encrypted_data FROM user_shows WHERE user_id = ? AND id = ?', args: [ctx.grant.userId, id] });
  if (!rows.rows[0]) throw new AssistantToolError('Show not found.');
  const cipher = String(rows.rows[0][0]);
  return { show: await decodeShow(cipher, id, ctx.grant), cipher, revision: await cipherHash(cipher) };
}

const STALE_SHOW = 'Show changed since it was read. Read get_show again before making a new update.';

/** Load a show and refuse unless it is still the version the model read. */
export async function loadShowAt(ctx: AssistantContext, id: unknown, expected: unknown): Promise<LoadedShow> {
  const wanted = showId(id);
  const expectedRevision = revision(expected);
  const loaded = await loadShow(ctx, wanted);
  if (loaded.revision !== expectedRevision) throw new AssistantToolError(STALE_SHOW);
  return loaded;
}

/**
 * Every readable show in the account, a page at a time so a large account is
 * never held as ciphertext all at once. A row that does not decrypt under the
 * delegated keys is passed over, as the app sets aside rows it cannot read.
 */
export async function forEachShow(ctx: AssistantContext, visit: (loaded: LoadedShow) => void | Promise<void>): Promise<void> {
  let after = '';
  for (;;) {
    const page = await ctx.db.execute({
      sql: 'SELECT id, encrypted_data FROM user_shows WHERE user_id = ? AND id > ? ORDER BY id LIMIT 100',
      args: [ctx.grant.userId, after],
    });
    for (const row of page.rows) {
      const id = String(row[0]);
      const cipher = String(row[1]);
      let show: Show;
      try { show = await decodeShow(cipher, id, ctx.grant); } catch { continue; }
      await visit({ show, cipher, revision: await cipherHash(cipher) });
    }
    if (page.rows.length < 100) return;
    after = String(page.rows[page.rows.length - 1][0]);
  }
}

export interface ShowChange {
  id: string;
  /** The revision the change was made over; null for a new show. */
  expectedHash: string | null;
  /** The show to store, or null to remove the row. */
  show: Show | null;
}

/** Write shows atomically under compare-and-swap. Returns each written show's new revision. */
export async function saveShows(ctx: AssistantContext, changes: ShowChange[]): Promise<Map<string, string>> {
  const encrypted = await Promise.all(changes.map(async change => {
    const cipher = change.show === null ? null : await encryptShow(change.show, ctx.grant.key);
    if (cipher !== null && cipher.length > MAX_SAVE_BYTES) {
      throw new AssistantToolError('This show would be too large for the app to save. Remove a large upload in the app first.');
    }
    return { id: change.id, expectedHash: change.expectedHash, encryptedData: cipher };
  }));
  const response = await applyShowChanges(ctx.db, ctx.grant.userId, encrypted);
  if (response.status === 409) throw new AssistantToolError(STALE_SHOW);
  if (!response.ok) throw new AssistantToolError('The show could not be saved.');
  const revisions = new Map<string, string>();
  for (const change of encrypted) if (change.encryptedData !== null) revisions.set(change.id, await cipherHash(change.encryptedData));
  return revisions;
}

/** Write one show over the revision it was read at, and return its new revision. */
export async function saveShow(ctx: AssistantContext, show: Show, expectedHash: string | null): Promise<string> {
  return (await saveShows(ctx, [{ id: show.id, expectedHash, show }])).get(show.id)!;
}

// ── Settings ────────────────────────────────────────────────────────────────

export interface LoadedSettings {
  /** Null for an account that has never saved settings (not yet onboarded). */
  settings: AppSettings | null;
  cipher: string | null;
  hash: string | null;
}

export async function loadSettings(ctx: AssistantContext): Promise<LoadedSettings> {
  const rows = await ctx.db.execute({ sql: 'SELECT encrypted_data FROM user_settings WHERE user_id = ?', args: [ctx.grant.userId] });
  if (!rows.rows[0]) return { settings: null, cipher: null, hash: null };
  const cipher = String(rows.rows[0][0]);
  let settings: AppSettings;
  try {
    settings = await decryptShow<AppSettings>(cipher, [ctx.grant.key, ...(ctx.grant.legacyKey ? [ctx.grant.legacyKey] : [])]);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid settings');
  } catch {
    throw new AssistantToolError('Your account settings could not be read. Disconnect and reconnect the account.');
  }
  return { settings, cipher, hash: await cipherHash(cipher) };
}

/** Settings that can be written to: the app has set the account up. */
export async function loadWritableSettings(ctx: AssistantContext): Promise<LoadedSettings & { settings: AppSettings }> {
  const loaded = await loadSettings(ctx);
  if (!loaded.settings) throw new AssistantToolError('Open the app once to finish setting up this account, then try again.');
  return loaded as LoadedSettings & { settings: AppSettings };
}

/** The settings blob changed between being read and being written. */
export class StaleSettingsError extends AssistantToolError {}

/**
 * Replace the settings blob, but only over the version that was read. A blob
 * saved meanwhile by the app or another device is never overwritten.
 */
export async function saveSettings(ctx: AssistantContext, loaded: LoadedSettings, next: AppSettings): Promise<void> {
  const cipher = await encryptShow(next, ctx.grant.key);
  if (cipher.length > MAX_SAVE_BYTES) {
    throw new AssistantToolError('Your settings would be too large for the app to save. Empty Recently deleted in the app first.');
  }
  const response = await applySettingsWrite(ctx.db, ctx.grant.userId, cipher, loaded.hash);
  if (response.status === 409) throw new StaleSettingsError('Your account changed while this was being saved. Read it again and retry.');
  if (!response.ok) throw new AssistantToolError('Your settings could not be saved.');
}

/**
 * File something new in the settings, such as a link just made. Adding to a
 * list is the one settings edit that means the same over any version, so a
 * blob saved meanwhile is read again and the addition made to that — the way
 * the app merges an edit into a newer copy — rather than refused. It is still
 * written only over the version it was made to.
 */
export async function addToSettings(ctx: AssistantContext, add: (settings: AppSettings) => AppSettings): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const loaded = await loadWritableSettings(ctx);
    try {
      await saveSettings(ctx, loaded, add(loaded.settings));
      return;
    } catch (err) {
      if (!(err instanceof StaleSettingsError) || attempt >= 2) throw err;
    }
  }
}
