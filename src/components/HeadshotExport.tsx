import { useRef, useState } from 'react';
import type { Performer } from '../types';
import { Icon } from './Icon';
import { billedPerformers, surpriseGuests } from '../utils/surpriseGuests';
import {
  asShareableFiles,
  canShareFiles,
  chooseDelivery,
  countHeadshots,
  exportNote,
  gatherHeadshots,
  headshotButtonLabel,
  headshotZip,
  shareHeadshots,
  zipFileName,
  type HeadshotFile,
} from '../utils/headshotExport';
import { deliverFile, deliveryProblem } from '../utils/download';
import './HeadshotExport.css';

type Note = NonNullable<ReturnType<typeof exportNote>>;

/** Which photos a prepared batch came from, so a stale batch is never handed over. */
function photosKey(performers: Performer[]): string {
  return JSON.stringify(performers.map((p) => [p.id, p.name, p.photo ?? '']));
}

/**
 * Every headshot on the bill in one tap, each file named after the act.
 *
 * Not shown until somebody on the lineup has a photo: a button whose only
 * possible answer is "there is nothing to download" is clutter in a row of
 * tools that do something.
 *
 * The bill, not the whole lineup: these go to whoever makes the flyer and
 * whoever posts the socials, and a surprise guest's face in that pack, filed
 * under their name, is the spoiler the flag is there to prevent. With
 * `includesGuests` it is everyone, guests too, and it is offered only when a
 * guest has a photo to add.
 */
export function HeadshotExport({ performers, showName, includesGuests = false }: {
  performers: Performer[];
  showName?: string;
  includesGuests?: boolean;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Photos fetched on an iPhone or iPad after the tap that asked for them had
  // gone stale. A share sheet only opens from a fresh tap, so they wait here
  // for one rather than being fetched all over again.
  const [ready, setReady] = useState<{ key: string; files: HeadshotFile[] } | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const running = useRef(false);
  const people = includesGuests ? performers : billedPerformers(performers);
  const count = countHeadshots(people);
  if (count === 0 || (includesGuests && countHeadshots(surpriseGuests(performers)) === 0)) return null;
  // Worked out only while a batch is waiting. An older show can still hold its
  // photos as data URLs, and the lineup tools redraw with every edit to the
  // show, so building it on each render would be megabytes of string per
  // keystroke for a comparison that is almost never needed.
  const waiting = ready && ready.key === photosKey(people) ? ready.files : null;

  async function saveZip(files: HeadshotFile[]) {
    try {
      // In the iOS app this is the share sheet too, so it can be refused.
      const problem = deliveryProblem(await deliverFile(headshotZip(files), zipFileName(showName, { includesGuests })));
      if (problem) setNote({ tone: 'alert', text: problem });
    } catch {
      setNote({ tone: 'alert', text: "Couldn't put the headshots into one file. Try again." });
    }
  }

  async function start() {
    if (running.current) return;
    running.current = true;
    const key = photosKey(people);
    setNote(null);
    setReady(null);
    setProgress({ done: 0, total: count });
    try {
      const { files, missing } = await gatherHeadshots(people, undefined, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setNote(exportNote(files.length, missing));
      if (files.length === 0) return;
      const shareable = asShareableFiles(files);
      const delivery = chooseDelivery({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        canShareFiles: canShareFiles(shareable),
      });
      if (delivery === 'share') {
        const outcome = await shareHeadshots(shareable);
        if (outcome === 'needs-tap') {
          setReady({ key, files });
          return;
        }
        // Shared, or the sheet was closed on purpose: either way, done.
        if (outcome !== 'failed') return;
      }
      await saveZip(files);
    } catch {
      setNote({ tone: 'alert', text: "Couldn't get the headshots. Check your connection and try again." });
    } finally {
      running.current = false;
      setProgress(null);
    }
  }

  async function shareWaiting(files: HeadshotFile[]) {
    setReady(null);
    // Straight from this tap, before anything is awaited.
    const outcome = await shareHeadshots(asShareableFiles(files));
    if (outcome === 'needs-tap' || outcome === 'failed') await saveZip(files);
  }

  return (
    <>
      {waiting ? (
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void shareWaiting(waiting)}>
          <Icon name="download" size={16} /> Save {waiting.length} headshot{waiting.length === 1 ? '' : 's'}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => void start()}
          disabled={!!progress}
          aria-busy={!!progress}
          title={includesGuests
            ? 'Every headshot on this show, surprise guests included, each file named after the performer'
            : 'Every headshot on the bill, each file named after the performer'}
        >
          <Icon name="download" size={16} /> {headshotButtonLabel(count, progress, { includesGuests })}
        </button>
      )}
      {/* The button counts through on screen, but it is disabled while it
          works, so a screen reader is no longer on it to hear the count. This
          says it once. It stays in the page, empty at rest, so the words land
          in a region the screen reader is already watching. */}
      <span className="visually-hidden" role="status">
        {progress ? `Preparing ${progress.total} headshot${progress.total === 1 ? '' : 's'}…` : ''}
      </span>
      {waiting && (
        <p className="headshot-export__note" role="status">
          Ready. Tap Save to put them in Photos or Files.
        </p>
      )}
      {note && (
        <p className="headshot-export__note headshot-export__note--warning" role={note.tone}>
          {note.text}
        </p>
      )}
    </>
  );
}
