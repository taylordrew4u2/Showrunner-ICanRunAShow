import type { Show, ShowStatus } from '../types';
import { billedPerformers } from './surpriseGuests';

/** The deliberately small, public bill. No producer data belongs in this type. */
export interface WebsiteShow {
  id: string;
  name: string;
  date: string;
  time: string;
  venueName: string;
  location: string;
  ticketLink: string;
  status: ShowStatus;
  lineup: { id?: string; name: string; credits?: string }[];
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid website lineup.');
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())
    || [...value].some(character => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    })) throw new Error('Invalid website lineup.');
  return value;
}

function ticketLink(value: unknown): string {
  const link = text(value, 2048);
  if (link && !/^https?:\/\//i.test(link)) throw new Error('Invalid website ticket link.');
  if (link) {
    const url = new URL(link);
    if (url.username || url.password) throw new Error('Invalid website ticket link.');
  }
  return link;
}

/** Strictly validate an already-redacted publication, rejecting extra fields. */
export function parseWebsiteShow(value: unknown): WebsiteShow {
  const row = object(value, ['id', 'name', 'date', 'time', 'venueName', 'location', 'ticketLink', 'status', 'lineup']);
  const id = text(row.id, 128, true);
  if (!/^[A-Za-z0-9_-]+$/.test(id)
    || !['upcoming', 'in-progress', 'completed', 'cancelled'].includes(row.status as string)
    || !Array.isArray(row.lineup) || row.lineup.length > 500) throw new Error('Invalid website lineup.');
  return {
    id, name: text(row.name, 200, true), date: text(row.date, 32), time: text(row.time, 32),
    venueName: text(row.venueName, 1000), location: text(row.location, 1000),
    ticketLink: ticketLink(row.ticketLink), status: row.status as ShowStatus,
    lineup: row.lineup.map(value => {
      const person = object(value, ['id', 'name', 'credits']);
      return {
        ...(person.id === undefined ? {} : { id: text(person.id, 128, true) }),
        name: text(person.name, 200, true),
        ...(person.credits === undefined ? {} : { credits: text(person.credits, 4000) }),
      };
    }),
  };
}

/** Called only for an explicitly configured show, while its owner has it open. */
export function publicWebsiteShow(show: Show): WebsiteShow {
  let link = '';
  try { link = ticketLink(show.ticketLink ?? ''); } catch { /* An unsafe link is never published. */ }
  return parseWebsiteShow({
    id: show.id, name: show.name, date: show.date, time: show.time,
    venueName: show.venueName, location: show.location, ticketLink: link, status: show.status,
    lineup: billedPerformers(show.performers ?? []).map(person => ({
      id: person.id, name: person.name,
      ...(person.credits === undefined ? {} : { credits: person.credits }),
    })),
  });
}
