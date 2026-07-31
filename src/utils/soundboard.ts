import type { DJSong, Performer, ScheduleItem } from '../types';

/**
 * The Run Show soundboard.
 *
 * Music used to be welded to the clock: whatever the current cue resolved to
 * was the only thing that could play, and moving through the running order
 * stopped it. That is not how a show sounds. The operator drops a walk-on when
 * the host says the name, kills it when the performer reaches the mic, and
 * fires a DJ track between sets — none of it on the timer's schedule.
 *
 * So the board is built once, up front: one button per performer who has a
 * song, one per cue track that belongs to nobody, and a separate bank for the
 * DJ list. Nothing here reads the clock, and pressing a button never moves it.
 */

export interface SoundboardTrack {
  /** Stable button id — also what Run Show tracks as "currently playing". */
  key: string;
  /** Audio source: a `media:` store reference, data URL, or http link. */
  src: string;
  /** Primary label — the performer's name, or the song title. */
  label: string;
  /** Secondary label — the track name, or the recording artist. */
  sublabel?: string;
  /** Letter shown on the round face button when there's no photo. */
  initial: string;
  /** Position in the running order, when the track belongs to a cue. */
  cueIndex?: number;
}

export interface Soundboard {
  /** One per performer with a song, in running order. */
  performers: SoundboardTrack[];
  /** Cue uploads that aren't anybody's walk-on — stings, intro beds, outros. */
  cues: SoundboardTrack[];
  /** Uploaded DJ songs, kept apart from the performer bank. */
  dj: SoundboardTrack[];
}

function initialOf(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

/**
 * Who's on stage for a cue: the linked performer record, else an exact name
 * match on the free-text field. Deliberately strict — a guess here would put
 * the wrong face on a button.
 */
export function resolveCuePerformer(
  cue: ScheduleItem | undefined,
  performers: Performer[],
): Performer | null {
  if (!cue) return null;
  if (cue.performerId) return performers.find((p) => p.id === cue.performerId) ?? null;
  const name = (cue.performer ?? '').trim().toLowerCase();
  if (!name) return null;
  return performers.find((p) => p.name.trim().toLowerCase() === name) ?? null;
}

/**
 * The performer a cue is *about*, for labelling purposes: the resolved record,
 * or just the name typed on the cue.
 */
export function cuePerformerName(
  cue: ScheduleItem | undefined,
  performers: Performer[],
): string {
  return resolveCuePerformer(cue, performers)?.name || cue?.performer?.trim() || '';
}

/**
 * Build the board from a show. Performers come out in running order (whoever
 * the schedule reaches first), then anyone in the lineup who never got a cue —
 * a late add still has a button.
 */
export function buildSoundboard(
  schedule: ScheduleItem[],
  performers: Performer[],
  djSongs: DJSong[] = [],
): Soundboard {
  const byPerformer = new Map<string, SoundboardTrack>();
  const cues: SoundboardTrack[] = [];

  schedule.forEach((cue, i) => {
    const performer = resolveCuePerformer(cue, performers);
    if (performer) {
      // A cue upload is this segment's music and beats the stored walk-on —
      // that's the override the schedule editor offers. First cue wins, so a
      // performer with two spots doesn't get two buttons.
      if (cue.music && !byPerformer.has(performer.id)) {
        byPerformer.set(performer.id, {
          key: `performer:${performer.id}`,
          src: cue.music,
          label: performer.name,
          sublabel: cue.musicName || performer.walkOnMusicName,
          initial: initialOf(performer.name),
          cueIndex: i,
        });
      } else if (!byPerformer.has(performer.id) && performer.walkOnMusic) {
        byPerformer.set(performer.id, {
          key: `performer:${performer.id}`,
          src: performer.walkOnMusic,
          label: performer.name,
          sublabel: [performer.walkOnMusicName, performer.walkOnMusicArtist]
            .filter(Boolean)
            .join(' — ') || undefined,
          initial: initialOf(performer.name),
          cueIndex: i,
        });
      }
      return;
    }
    // No performer on this cue — an upload here is a show track (walk-in
    // music, a sting, the outro), so it gets its own button rather than
    // disappearing because nobody owns it.
    if (cue.music) {
      cues.push({
        key: `cue:${cue.id}`,
        src: cue.music,
        label: cue.description?.trim() || `Cue ${i + 1}`,
        sublabel: cue.musicName,
        initial: initialOf(cue.description || 'Cue'),
        cueIndex: i,
      });
    }
  });

  // Anyone in the lineup the schedule never reached.
  for (const p of performers) {
    if (byPerformer.has(p.id) || !p.walkOnMusic) continue;
    byPerformer.set(p.id, {
      key: `performer:${p.id}`,
      src: p.walkOnMusic,
      label: p.name,
      sublabel: [p.walkOnMusicName, p.walkOnMusicArtist].filter(Boolean).join(' — ') || undefined,
      initial: initialOf(p.name),
    });
  }

  const dj: SoundboardTrack[] = djSongs
    .filter((s) => !!s.music)
    .map((s) => ({
      key: `dj:${s.id}`,
      src: s.music as string,
      label: s.title?.trim() || s.musicName || 'Untitled track',
      sublabel: s.artist?.trim() || undefined,
      initial: initialOf(s.title || s.musicName || 'Track'),
    }));

  return { performers: [...byPerformer.values()], cues, dj };
}

/** Every source on the board — what Run Show pre-decodes on open. */
export function soundboardSources(board: Soundboard): string[] {
  const all = [...board.performers, ...board.cues, ...board.dj].map((t) => t.src);
  return [...new Set(all)];
}
