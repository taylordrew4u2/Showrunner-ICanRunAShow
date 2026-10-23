import { api, type ApiError } from './api';
import { matchKnownName } from './cuePerformer';
import type { SessionCredentials } from './session-vault';
import { cuePerformerName, resolveCuePerformer } from './soundboard';
import { billedPerformers, isSurpriseGuest, SURPRISE_GUEST_LABEL, surpriseGuests } from './surpriseGuests';
import type { ColorScheme } from './theme';
import type { ViewerPlayback, ViewerTrack } from './viewerAudio';
import type { Performer, ScheduleItem } from '../types';

/** One cue as the room sees it: who is on, what the segment is, their credits. */
export interface LiveCue {
  name?: string;
  description?: string;
  credits?: string;
  /** A surprise guest's cue — held back as "Surprise guest" until they are on. */
  surprise?: boolean;
}

// What viewers see. Kept small so we can push it cheaply on state changes; the
// viewer ticks the timer locally between updates using lastUpdateMs.
export interface LiveViewPayload {
  showName: string;
  status: 'scheduled' | 'idle' | 'countdown' | 'running' | 'paused' | 'ended';
  countdown?: number; // pre-roll seconds when status === 'countdown'
  startsAt?: string; // ISO date-time when the show is scheduled to start
  note?: string; // optional admin note shown pre-show
  theme?: ColorScheme; // producer's color scheme, so the public viewer matches the app
  lineup?: { name: string; credits?: string }[]; // performers in order — shown pre-show, esp. when there's no schedule
  segment?: LiveCue;
  next?: Omit<LiveCue, 'credits'>;
  totalSec?: number;
  remainingAtLastUpdate?: number; // seconds left when this payload was written
  lastUpdateMs: number; // host wall-clock time of the write
  /**
   * Tracks the board has published for the viewer to play — just ids and chunk
   * counts, so the manifest stays inside the payload's size cap however big
   * the audio is. The audio itself is in /api/live-media, and the key to read
   * it is in the viewer link's fragment, never here.
   */
  audio?: ViewerTrack[];
  /** What the viewer should be playing right now, if anything. */
  playback?: ViewerPlayback;
}

/**
 * Push the current state to the audience's page.
 *
 * Authenticated, and deliberately so: the viewer token is the link handed to
 * the room, so it identifies the page but cannot be the permission to write to
 * it. Without this, anyone holding a viewer link could overwrite what the
 * room's screen showed mid-show. The server checks the token belongs to this
 * account — see api/live.ts.
 */
export async function publishLiveView(
  token: string,
  payload: LiveViewPayload,
  creds: SessionCredentials,
): Promise<{ stale: boolean }> {
  const res = await api.post<{ ok?: boolean; stale?: boolean }>(
    '/api/live',
    { token, payload },
    { authUserId: creds.userId, authHash: creds.authHash },
  );
  // The server keeps a newer state than this one and says so — see
  // STALE_PUBLISH_WINDOW_MS in api/live.ts.
  return { stale: !!res?.stale };
}

/**
 * The same state, written as of a later moment.
 *
 * The room counts a running cue down from when a publish reached it, so a
 * resend that only moved the time forward would put back every second that
 * passed since the first try. What was left is counted down to the new time.
 */
export function restampPayload(payload: LiveViewPayload, at: number): LiveViewPayload {
  const restamped = { ...payload, lastUpdateMs: at };
  if (payload.status === 'running' && payload.remainingAtLastUpdate !== undefined) {
    restamped.remainingAtLastUpdate = payload.remainingAtLastUpdate - (at - payload.lastUpdateMs) / 1000;
  }
  return restamped;
}

/** How long to wait before sending the room's state again. The last repeats. */
export const LIVE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

export interface LivePublisher {
  /** Send this state now, and again until it lands or a newer one replaces it. */
  publish(payload: LiveViewPayload, creds: SessionCredentials): void;
  /** The latest state this device has published to the link, as first stamped. */
  last(): LiveViewPayload | null;
  /**
   * Hear the server's answer to the latest state: its refusal, or null once
   * one lands. Told the answer so far straight away. Returns the unsubscribe.
   */
  subscribe(listener: (refusal: ApiError | null) => void): () => void;
}

/**
 * Sends the board's state to the room and makes sure the latest one lands.
 *
 * The board only publishes when something changes, so a publish that was
 * lost used to stay lost: a cue change that timed out on venue wifi left the
 * previous act "On stage" for the whole set, and a lost stop left a walk-on
 * running on the PA, until the operator happened to press something else. A
 * publish the server refused as older than what it holds (a clock running
 * behind another device's) was taken for success the same way.
 *
 * So the latest state is kept and sent again, spaced out, until the server
 * takes it. Only the latest: once the board has moved on, the newer state is
 * what gets sent. A refusal (the session has gone, the link is someone
 * else's, the account's links are full) is an answer, and asking again will
 * not change it — it goes to whoever is subscribed, so the one the producer
 * can act on can be shown.
 *
 * Nothing is sent while things are going well beyond what the board asks
 * for: a board left open on a second device must not keep pushing its old
 * state over the one the show is actually being run from.
 */
export function createLivePublisher(
  token: string,
  send: (token: string, payload: LiveViewPayload, creds: SessionCredentials) => Promise<{ stale: boolean }> = publishLiveView,
  delays: readonly number[] = LIVE_RETRY_DELAYS_MS,
): LivePublisher {
  let latest = 0;
  let lastPayload: LiveViewPayload | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refusal: ApiError | null = null;
  const listeners = new Set<(refusal: ApiError | null) => void>();

  /** The answer to the latest state. One to a state the board has moved on from says nothing. */
  function answered(id: number, answer: ApiError | null) {
    if (id !== latest) return;
    refusal = answer;
    for (const listener of listeners) listener(answer);
  }

  function attempt(id: number, payload: LiveViewPayload, creds: SessionCredentials, tries: number) {
    const retry = () => {
      if (id !== latest) return;
      const delay = delays[Math.min(tries, delays.length - 1)];
      timer = setTimeout(() => {
        timer = undefined;
        if (id === latest) attempt(id, restampPayload(payload, Date.now()), creds, tries + 1);
      }, delay);
    };
    send(token, payload, creds).then(
      (res) => {
        if (res.stale) retry();
        else answered(id, null);
      },
      (err) => {
        const status = (err as ApiError).status;
        if (status === undefined || status >= 500) retry();
        else answered(id, err as ApiError);
      },
    );
  }

  return {
    publish(payload, creds) {
      latest++;
      lastPayload = payload;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      attempt(latest, payload, creds, 0);
    },
    last: () => lastPayload,
    subscribe(listener) {
      listeners.add(listener);
      listener(refusal);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * Withdraw a viewer link: the room's page goes blank, the audio sent under it
 * goes with it, and the link stops counting among the account's links.
 */
export async function withdrawLiveView(token: string, creds: SessionCredentials): Promise<void> {
  await api.del(`/api/live?token=${encodeURIComponent(token)}`, {
    authUserId: creds.userId,
    authHash: creds.authHash,
  });
}

/**
 * How long a board's last word holds the room against the show page. Longer
 * than any show runs between two presses; shorter than the gap to the next
 * night, so a board that died without closing does not hold it for good.
 */
export const BOARD_HOLD_MS = 6 * 60 * 60 * 1000;

/**
 * Whether a board is running the room, going by the state the server holds.
 *
 * The show page puts the pre-show screen back up whenever an upcoming show is
 * opened or edited, and "upcoming" only changes once the timer is started — a
 * night run on Next and the pads alone never changes it, and another device
 * sees the change only after it syncs. A co-host opening the show on a tablet
 * mid-set flipped the room from the act on stage back to "starting soon".
 *
 * `ownLast` is what this device last published. A live state older than that
 * is this device's own board, closed a moment ago, whose closing publish has
 * not landed yet — it holds nothing.
 */
export function boardHoldsRoom(
  current: LiveViewPayload | null,
  now: number,
  ownLast: LiveViewPayload | null,
): boolean {
  if (!current || current.status === 'scheduled' || current.status === 'ended') return false;
  if (ownLast && current.lastUpdateMs <= ownLast.lastUpdateMs) return false;
  return now - current.lastUpdateMs < BOARD_HOLD_MS;
}

const publishers = new Map<string, LivePublisher>();

/**
 * The one publisher for a viewer link. Shared, so a board reopened while the
 * last one's closing state is still being retried replaces it rather than
 * having it land on top of the new board's.
 */
export function livePublisher(token: string): LivePublisher {
  let publisher = publishers.get(token);
  if (!publisher) {
    publisher = createLivePublisher(token);
    publishers.set(token, publisher);
  }
  return publisher;
}

export async function fetchLiveView(token: string): Promise<LiveViewPayload | null> {
  const { payload } = await api.get<{ payload: LiveViewPayload | null }>(
    `/api/live?token=${encodeURIComponent(token)}`,
  );
  return payload;
}

/**
 * The lineup the viewer link may post before the show: the bill in its order,
 * without the surprise guests. Left out rather than masked — a row reading
 * "Surprise guest" is a spoiler of its own, and whether to tease one is the
 * producer's call in their note, not the app's.
 */
export function publicLineup(performers: Performer[]): NonNullable<LiveViewPayload['lineup']> {
  return billedPerformers(performers).map((p) => ({ name: p.name, credits: p.credits }));
}

/**
 * What the room's screen may say about one cue.
 *
 * The payload is public — anyone holding the viewer link can read it whole,
 * not just what the page draws — so a surprise guest who has not walked on
 * yet must not be anywhere in it. That covers their own cue, which goes out
 * as "Surprise guest", and the cues around it that name them: the running
 * order the generator writes has the host's handover as "Intro — <name>", and
 * that line is shown as the host's cue with the description held back. Once
 * the guest is in `revealed` (see guestsOnStageBy) they are out, and their cue
 * says who they are.
 */
export function publicCue(
  cue: ScheduleItem | undefined,
  performers: Performer[],
  revealed: ReadonlySet<string>,
): LiveCue {
  if (!cue) return {};
  const held: LiveCue = { name: SURPRISE_GUEST_LABEL, surprise: true };
  const person = resolveCuePerformer(cue, performers);
  if (person && isSurpriseGuest(person)) {
    if (!revealed.has(person.id)) return held;
    return { name: person.name, description: cue.description, credits: person.credits, surprise: true };
  }

  const secret = surpriseGuests(performers)
    .filter((guest) => !revealed.has(guest.id))
    .map((guest) => guest.name);
  // Every length counts. Matching cues to the Rolodex skips names under three
  // letters, so "Al" cannot fill in a cue that says "already"; here a short
  // stage name in the host's intro line is still the guest given away, and a
  // line held back by mistake costs the room nothing.
  const namesGuest = (text: string) => matchKnownName(text, secret, 1) !== null;
  const name = cuePerformerName(cue, performers);
  // A name typed on the cue rather than linked, but a guest's all the same.
  if (!person && name && namesGuest(name)) return held;
  if (cue.description && namesGuest(cue.description)) {
    // Somebody else is on: say who, and keep the line that gives the guest
    // away. Nobody named at all, and the line was the only thing on the cue —
    // it is the guest's cue in everything but the link.
    return name ? { name, credits: person?.credits } : held;
  }
  return { name: name || undefined, description: cue.description, credits: person?.credits };
}

/**
 * Whether a cue on the viewer is a surprise guest who has been revealed. Held,
 * the board sends the label in their place; revealed, it sends their name.
 */
export function isRevealedGuest(cue: Pick<LiveCue, 'name' | 'surprise'>): boolean {
  return !!cue.surprise && !!cue.name && cue.name !== SURPRISE_GUEST_LABEL;
}

/**
 * The letter on a cue's face in the viewer. A held guest's is a question mark,
 * not the S of "Surprise". Asked of each cue on its own, so a guest already
 * revealed who is back up next for a second spot shows their initial beside
 * their name rather than a "?".
 */
export function cueInitial(cue: Pick<LiveCue, 'name' | 'surprise'>, fallback: string): string {
  if (cue.surprise && !isRevealedGuest(cue)) return '?';
  return (cue.name || fallback).charAt(0).toUpperCase();
}

/**
 * The surprise guests who have reached the stage by cue `idx`: anyone whose
 * own cue is this one or one already passed.
 *
 * Only once the show is actually under way. Before the clock has run, the
 * operator stepping through the running order to check it is not the guest
 * walking on, and the room's screen must not take it as one.
 */
export function guestsOnStageBy(
  schedule: Pick<ScheduleItem, 'performer' | 'performerId'>[],
  performers: Performer[],
  idx: number,
  started: boolean,
): string[] {
  if (!started) return [];
  const ids: string[] = [];
  schedule.slice(0, Math.max(0, idx + 1)).forEach((cue) => {
    const person = resolveCuePerformer(cue, performers);
    if (person && isSurpriseGuest(person) && !ids.includes(person.id)) ids.push(person.id);
  });
  return ids;
}
