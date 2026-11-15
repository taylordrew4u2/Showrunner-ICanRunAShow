import type { Client } from '@libsql/client';
import type { Show, ShowStatus } from '../../src/types';
import { decryptShow, encryptShow } from './chatgptCipher';
import { applyShowChanges, cipherHash } from './showWrites';

export interface ChatgptShowGrant {
  userId: string;
  key: string;
  legacyKey?: string;
  scope: string;
}

export class ChatgptToolError extends Error {}

const statuses: ShowStatus[] = ['upcoming', 'in-progress', 'completed', 'cancelled'];
const fields = {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  date: { type: 'string', description: 'Local event date as YYYY-MM-DD, or empty if undecided.', maxLength: 10 },
  time: { type: 'string', description: 'Local start time as HH:MM (24-hour clock), or empty if undecided.', maxLength: 5 },
  location: { type: 'string', maxLength: 500 },
  venueName: { type: 'string', maxLength: 200 },
  status: { type: 'string', enum: statuses },
  ticketLink: { type: 'string', description: 'HTTPS ticket URL, or empty to clear it.', maxLength: 2048 },
};
const idSchema = { type: 'string', minLength: 1, maxLength: 128 };

export const SHOW_TOOLS = [
  {
    name: 'list_shows',
    title: 'List shows',
    description: 'List this connected producer’s shows, including past shows. Returns only show details, without private contacts, notes, media or credentials. Paginate with next_cursor.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        status: { type: 'string', enum: statuses },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        cursor: { type: 'string', description: 'The next_cursor from the previous result.' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'get_show',
    title: 'Read a show',
    description: 'Read one show’s details, lineup names and running order. Use the returned revision as expected_revision when updating. No private contacts, notes, media or share keys are returned.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: idSchema }, required: ['id'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'create_show',
    title: 'Create a show',
    description: 'Create a show in this connected account with an empty lineup and running order. Only create a show the user has requested. Dates and times are local to the event.',
    inputSchema: { type: 'object', additionalProperties: false, properties: fields, required: ['name'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'update_show',
    title: 'Update a show',
    description: 'Change only the requested show details. Read get_show first and pass its revision; concurrent changes are refused. Changing status to completed removes the show from Upcoming while preserving History. Does not delete shows or alter lineups, running orders, contacts, contracts or media.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        id: idSchema,
        expected_revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        patch: { type: 'object', properties: fields, additionalProperties: false, minProperties: 1 },
      },
      required: ['id', 'expected_revision', 'patch'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChatgptToolError('Arguments must be an object.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.includes(key))) throw new ChatgptToolError('Unsupported argument.');
  return record;
}

function showId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ChatgptToolError('A valid show id is required.');
  return value;
}

type ShowPatch = Partial<Pick<Show, 'name' | 'date' | 'time' | 'location' | 'venueName' | 'status' | 'ticketLink'>>;

function validDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validatePatch(value: unknown): ShowPatch {
  const patch = object(value, Object.keys(fields));
  if (Object.keys(patch).length === 0) throw new ChatgptToolError('At least one show detail is required.');
  const limits: Record<string, number> = { name: 200, date: 10, time: 5, location: 500, venueName: 200, status: 20, ticketLink: 2048 };
  for (const [key, item] of Object.entries(patch)) {
    if (typeof item !== 'string' || item.length > limits[key] || [...item].some(character => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })) {
      throw new ChatgptToolError(`Invalid ${key}.`);
    }
  }
  if (patch.name !== undefined && !(patch.name as string).trim()) throw new ChatgptToolError('Show name cannot be empty.');
  if (patch.date !== undefined && !validDate(patch.date as string)) throw new ChatgptToolError('Date must be a real YYYY-MM-DD date or empty.');
  if (patch.time !== undefined && patch.time !== '' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(patch.time as string)) {
    throw new ChatgptToolError('Time must be HH:MM on a 24-hour clock or empty.');
  }
  if (patch.status !== undefined && !statuses.includes(patch.status as ShowStatus)) throw new ChatgptToolError('Invalid show status.');
  if (patch.ticketLink) {
    let link: URL;
    try { link = new URL(patch.ticketLink as string); } catch { throw new ChatgptToolError('Ticket link must be an HTTPS URL or empty.'); }
    if (link.protocol !== 'https:' || link.username || link.password) throw new ChatgptToolError('Ticket link must be an HTTPS URL or empty.');
  }
  return patch as ShowPatch;
}

function can(grant: ChatgptShowGrant, scope: string): void {
  if (!grant.scope.split(' ').includes(scope)) throw new ChatgptToolError(`This connection needs ${scope} permission.`);
}

async function decode(ciphertext: string, grant: ChatgptShowGrant): Promise<Show> {
  try {
    const show = await decryptShow<Show>(ciphertext, [grant.key, ...(grant.legacyKey ? [grant.legacyKey] : [])]);
    if (!show || typeof show !== 'object' || typeof show.id !== 'string' || typeof show.name !== 'string') throw new Error('Invalid show');
    return show;
  } catch {
    throw new ChatgptToolError('This show could not be read. Disconnect and reconnect the account.');
  }
}

/** Explicit allowlist: never serialize a whole decrypted show to a tool result. */
function summary(show: Show) {
  return {
    id: show.id, name: show.name, date: show.date, time: show.time,
    location: show.location, venueName: show.venueName, status: show.status,
    ticketLink: show.ticketLink ?? '', createdAt: show.createdAt, updatedAt: show.updatedAt,
  };
}

async function load(db: Client, grant: ChatgptShowGrant, id: string): Promise<{ show: Show; cipher: string }> {
  const rows = await db.execute({ sql: 'SELECT encrypted_data FROM user_shows WHERE user_id = ? AND id = ?', args: [grant.userId, id] });
  if (!rows.rows[0]) throw new ChatgptToolError('Show not found.');
  const cipher = String(rows.rows[0][0]);
  const show = await decode(cipher, grant);
  if (show.id !== id) throw new ChatgptToolError('This show could not be read.');
  return { show, cipher };
}

async function write(db: Client, grant: ChatgptShowGrant, show: Show, expectedHash: string | null) {
  const cipher = await encryptShow(show, grant.key);
  const response = await applyShowChanges(db, grant.userId, [{ id: show.id, expectedHash, encryptedData: cipher }]);
  if (response.status === 409) throw new ChatgptToolError('Show changed since it was read. Read get_show again before making a new update.');
  if (!response.ok) throw new ChatgptToolError('The show could not be saved.');
  return { show: summary(show), revision: await cipherHash(cipher) };
}

export async function handleShowTool(db: Client, grant: ChatgptShowGrant, name: string, input: unknown): Promise<unknown> {
  can(grant, 'shows:read');
  if (name === 'list_shows') {
    const args = object(input ?? {}, ['status', 'limit', 'cursor']);
    if (args.status !== undefined && !statuses.includes(args.status as ShowStatus)) throw new ChatgptToolError('Invalid show status.');
    const limit = args.limit ?? 20;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ChatgptToolError('Limit must be between 1 and 100.');
    if (args.cursor !== undefined && (typeof args.cursor !== 'string' || !/^\d{1,8}$/.test(args.cursor))) throw new ChatgptToolError('Invalid cursor.');
    const offset = Number(args.cursor ?? 0);
    // Account-scoped SQL limits the maximum ciphertext read on each page. A
    // status filter is applied after decryption because status stays encrypted.
    const result = await db.execute({
      sql: 'SELECT id, encrypted_data FROM user_shows WHERE user_id = ? ORDER BY id LIMIT ? OFFSET ?',
      args: [grant.userId, limit + 1, offset],
    });
    const rows = result.rows.slice(0, limit);
    const decoded = await Promise.all(rows.map(async row => {
      const show = await decode(String(row[1]), grant);
      if (show.id !== String(row[0])) throw new ChatgptToolError('This show could not be read.');
      return show;
    }));
    const shows = decoded.filter(show => args.status === undefined || show.status === args.status).map(summary);
    return { shows, next_cursor: result.rows.length > limit ? String(offset + limit) : null };
  }

  if (name === 'get_show') {
    const args = object(input, ['id']);
    const { show, cipher } = await load(db, grant, showId(args.id));
    return {
      show: {
        ...summary(show),
        performers: (show.performers ?? []).map(person => ({ name: person.name })),
        artists: (show.artists ?? []).map(person => ({ name: person.name, artistType: person.artistType ?? '' })),
        schedule: (show.schedule ?? []).map(cue => ({
          id: cue.id, time: cue.time, description: cue.description,
          ...(cue.performer !== undefined ? { performer: cue.performer } : {}),
          ...(cue.durationMin !== undefined ? { durationMin: cue.durationMin } : {}),
        })),
      },
      revision: await cipherHash(cipher),
    };
  }

  if (name === 'create_show') {
    can(grant, 'shows:write');
    const patch = validatePatch(input);
    if (!patch.name) throw new ChatgptToolError('Show name is required.');
    const now = new Date().toISOString();
    const show: Show = {
      id: crypto.randomUUID(), name: patch.name, date: '', time: '', location: '', venueName: '', status: 'upcoming',
      performers: [], artists: [], schedule: [], hosts: [], djSongs: [], staff: [], vendors: [], expenses: [], scenes: [],
      createdAt: now, updatedAt: now, ...patch,
    };
    return write(db, grant, show, null);
  }

  if (name === 'update_show') {
    can(grant, 'shows:write');
    const args = object(input, ['id', 'expected_revision', 'patch']);
    const id = showId(args.id);
    if (typeof args.expected_revision !== 'string' || !/^[a-f0-9]{64}$/.test(args.expected_revision)) throw new ChatgptToolError('Read get_show first and supply its expected_revision.');
    const patch = validatePatch(args.patch);
    const { show, cipher } = await load(db, grant, id);
    if (await cipherHash(cipher) !== args.expected_revision) throw new ChatgptToolError('Show changed since it was read. Read get_show again before making a new update.');
    return write(db, grant, { ...show, ...patch, updatedAt: new Date().toISOString() }, args.expected_revision);
  }

  throw new ChatgptToolError('Unknown tool.');
}
