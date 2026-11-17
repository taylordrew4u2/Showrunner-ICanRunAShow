/**
 * Reading the owner's account in co-producer view.
 *
 * The server serves redacted, schema-checked views; this reads them all,
 * heals them as the owner's load does, and applies only the owner load's
 * deterministic tidying. Nothing here makes an id, so what the co-producer
 * sees as "now" is exactly what the owner's app would describe as "now".
 * Nothing is saved, recovered or parked: there is nowhere to save to.
 */
import type { AppSettings, Show } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { healSettings } from '../utils/secure-storage';
import { healShow } from '../utils/showHealing';
import { completePastShows } from '../utils/showsOverview';
import { stripLegacySettingsMedia, stripLegacyShowMedia } from '../utils/stripMedia';
import type { ReviewTruth } from './capture';
import { COPRODUCER_LIMITS, type CoproducerClient, type CoproducerShowPage } from './types';

/** The account as a co-producer sees it, and what it was read from. */
export interface LoadedReview extends ReviewTruth {
  /** Shows the server could not open, or that came back unusable. */
  unreadable: number;
  /** As served, before tidying: what a refresh starts from. */
  raw: { shows: Show[]; settings: AppSettings | null };
  /** Revisions of rows that came back unreadable, so a refresh asks for them again only once they change. */
  unreadableRevisions: Record<string, string>;
}

/**
 * The owner's load does these and nothing else that a co-producer would see
 * differently: legacy embedded media out, per-show expenses into the
 * account's list (ids kept), and past upcoming shows marked completed.
 * Rolodex linking is left out on purpose: it can make entries with new ids
 * the owner will never have.
 */
export function tidyReviewData(shows: Show[], settings: AppSettings): { shows: Show[]; settings: AppSettings } {
  // Copies: the legacy-media scrub works in place, and what was served is
  // kept as it came for the next refresh. JSON, as it crossed the wire.
  let tidiedShows = (JSON.parse(JSON.stringify(shows)) as Show[]).map((show) => stripLegacyShowMedia(show));
  const copy = JSON.parse(JSON.stringify(settings)) as AppSettings;
  let tidiedSettings = stripLegacySettingsMedia({ ...copy, expenses: copy.expenses || [] });
  const perShow = tidiedShows.flatMap((show) => show.expenses || []);
  if (perShow.length > 0) {
    const existing = new Set(tidiedSettings.expenses.map((expense) => expense.id));
    const moved = perShow.filter((expense) => !existing.has(expense.id));
    if (moved.length > 0) tidiedSettings = { ...tidiedSettings, expenses: [...tidiedSettings.expenses, ...moved] };
    tidiedShows = tidiedShows.map((show) => ({ ...show, expenses: [] }));
  }
  return { shows: completePastShows(tidiedShows), settings: tidiedSettings };
}

function settingsFrom(served: AppSettings | null): AppSettings {
  // An account never saved has no settings yet; it is past onboarding as far
  // as a co-producer is concerned, who has nothing to welcome.
  return served ? healSettings(served) : { ...DEFAULT_SETTINGS, onboarded: true };
}

interface ShowsRead {
  shows: Show[];
  revisions: Record<string, string>;
  unreadable: number;
}

function readPage(page: CoproducerShowPage, into: ShowsRead, seen: Set<string>): void {
  into.unreadable += page.unreadable;
  for (const { show, revision } of page.shows) {
    const healed = healShow(show);
    if (!healed || seen.has(healed.id)) {
      if (!healed) into.unreadable += 1;
      continue;
    }
    seen.add(healed.id);
    into.shows.push(healed);
    into.revisions[healed.id] = revision;
  }
}

function assemble(
  rawShows: Show[],
  rawSettings: AppSettings | null,
  revisions: Record<string, string>,
  settingsRevision: string | null,
  unreadable: number,
  unreadableRevisions: Record<string, string>,
): LoadedReview {
  const tidied = tidyReviewData(rawShows, settingsFrom(rawSettings));
  return {
    shows: tidied.shows,
    settings: tidied.settings,
    showRevisions: revisions,
    settingsRevision,
    unreadable,
    raw: { shows: rawShows, settings: rawSettings },
    unreadableRevisions,
  };
}

/** Every show, page by page, and the settings. */
export async function loadReviewData(client: CoproducerClient): Promise<LoadedReview> {
  const read: ShowsRead = { shows: [], revisions: {}, unreadable: 0 };
  const seen = new Set<string>();
  let after: string | undefined;
  for (;;) {
    const page = await client.showsPage(after);
    readPage(page, read, seen);
    if (page.next === null || page.next === after) break;
    after = page.next;
  }
  const view = await client.settings();
  return assemble(read.shows, view.settings, read.revisions, view.revision, read.unreadable, {});
}

/**
 * Shows by id, as many calls as it takes: each answer holds at most fifty,
 * and fewer when they are big. A call that brings nothing back means the
 * rest are gone or unreadable.
 */
async function showsByIds(client: CoproducerClient, ids: string[]): Promise<ShowsRead & { missing: string[] }> {
  const read: ShowsRead = { shows: [], revisions: {}, unreadable: 0 };
  const seen = new Set<string>();
  let remaining = ids;
  while (remaining.length > 0) {
    const asked = remaining.slice(0, COPRODUCER_LIMITS.showsPageMaxRows);
    const page = await client.showsByIds(asked);
    readPage(page, read, seen);
    const answered = new Set(page.shows.map((entry) => entry.show?.id));
    if (answered.size === 0) break;
    remaining = remaining.filter((id) => !answered.has(id));
  }
  return { ...read, missing: remaining };
}

/**
 * The account as it stands now, starting from what was read last: only the
 * shows whose revision moved are fetched, and the settings only when theirs
 * did. Null when nothing has moved.
 */
export async function refreshReviewData(client: CoproducerClient, previous: LoadedReview): Promise<LoadedReview | null> {
  const revisions = await client.revisions();
  const now = new Map(revisions.shows.map((entry) => [entry.id, entry.revision]));
  const known = (id: string) => previous.showRevisions[id] ?? previous.unreadableRevisions[id];
  const changed = [...now].filter(([id, revision]) => known(id) !== revision).map(([id]) => id);
  const gone = Object.keys(previous.showRevisions).filter((id) => !now.has(id));
  const settingsMoved = revisions.settings !== previous.settingsRevision;
  if (changed.length === 0 && gone.length === 0 && !settingsMoved) return null;

  const fetched = await showsByIds(client, changed);
  const replaced = new Map(fetched.shows.map((show) => [show.id, show]));
  // A changed show that did not come back is gone or unreadable now.
  const dropped = new Set([...gone, ...changed]);
  const rawShows: Show[] = [];
  for (const show of previous.raw.shows) {
    const fresh = replaced.get(show.id);
    if (fresh) {
      rawShows.push(fresh);
      replaced.delete(show.id);
    } else if (!dropped.has(show.id)) {
      rawShows.push(show);
    }
  }
  rawShows.push(...replaced.values());
  const showRevisions: Record<string, string> = {};
  for (const show of rawShows) {
    const revision = now.get(show.id) ?? fetched.revisions[show.id] ?? previous.showRevisions[show.id];
    if (revision !== undefined) showRevisions[show.id] = revision;
  }
  const unreadableRevisions: Record<string, string> = {};
  for (const [id, revision] of now) {
    if (!(id in showRevisions)) unreadableRevisions[id] = revision;
  }

  let rawSettings = previous.raw.settings;
  let settingsRevision = previous.settingsRevision;
  if (settingsMoved) {
    const view = await client.settings();
    rawSettings = view.settings;
    settingsRevision = view.revision;
  }
  return assemble(rawShows, rawSettings, showRevisions, settingsRevision, Object.keys(unreadableRevisions).length, unreadableRevisions);
}
