import { useEffect, useMemo, useRef, useState } from 'react';
import type { Show, ShowStatus, Scene, AppSettings, SectionKey, TodoItem, Performer, PotentialComic } from '../types';
import { generateId } from '../utils/id';
import { comicToPerformer } from '../utils/rolodex';
import { SceneList } from './SceneList';
import { Icon, type IconName } from './Icon';
import { MoreMenu, type MoreMenuItem } from './MoreMenu';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { PerformersSection } from './sections/PerformersSection';
import { PerformerContracts } from './sections/PerformerContracts';
import { AnnouncePost } from './AnnouncePost';
import { LineupActions } from './LineupActions';
import { ArtistsSection } from './sections/ArtistsSection';
import { ScheduleSection } from './sections/ScheduleSection';
import { ShowTimeline } from './ShowTimeline';
import { DJMusicSection } from './sections/DJMusicSection';
import { StaffSection } from './sections/StaffSection';
import { VendorsSection } from './sections/VendorsSection';
import { ShowRecapSection } from './sections/ShowRecapSection';
import { RunShow } from './RunShow';
import { Modal } from './Modal';
import { exportShowToPDF } from '../utils/pdfExport';
import { parseShowDate, formatShowTime, showStartISO } from '../utils/showDate';
import { daysUntil } from '../utils/showsOverview';
import { joinNames, scheduleSummary, staffSummary, vendorsSummary } from '../utils/sectionSummary';
import { publishLiveView, type LiveViewPayload } from '../utils/liveView';
import { loadColorScheme } from '../utils/theme';
import { useMediaUrl } from '../utils/useMediaUrl';
import { BrandMark } from './BrandMark';
import { showDJSongs } from '../utils/musicLibrary';
import { getRolodexTerm } from '../utils/terminology';
import { hostChoices } from '../utils/hostChoices';
import { refreshSignatures, signerStatus } from '../utils/contracts';
import { fileSignedHeadshots } from '../utils/signedHeadshots';
import { uploadMedia } from '../utils/mediaStore';
import {
  describeRecurrence,
  MAX_OCCURRENCES,
  RECURRENCE_LABELS,
  recurringDates,
  type RecurrencePattern,
} from '../utils/recurrence';
import type { SessionCredentials } from '../utils/session-vault';
import { loadViewerKey, viewerUrl as buildViewerUrl } from '../utils/viewerAudio';
import './ShowDetail.css';
import { useConfirm } from './useConfirm';

// Each section card wears the icon for what it holds, so the grid is scannable
// by shape once you know the page — a wall of same-looking cards is the failure
// mode of a bento layout.
const SECTION_ICONS: Record<string, IconName> = {
  basic: 'file',
  performers: 'users',
  artists: 'sparkle',
  schedule: 'schedule',
  dj: 'music',
  staff: 'wrench',
  vendors: 'bolt',
  scenes: 'tv',
  recap: 'check',
};

interface ShowDetailProps {
  show: Show;
  settings: AppSettings;
  /**
   * Open straight into live mode, for the dashboard's Run Show button. The
   * page still mounts underneath, so closing live mode lands on the show
   * rather than back where you came from.
   */
  startInRunShow?: boolean;
  onBack: () => void;
  onUpdate: (show: Show) => void;
  onSaveToRolodex?: (comic: import('../types').PotentialComic) => void;
  /**
   * Sending contracts from inside the show. Both are needed together — the
   * session to upload the document, the callback to file the request — so the
   * performer's contracts only appear when the app can actually send one.
   */
  session?: SessionCredentials;
  onUpdateSettings?: (settings: AppSettings) => void;
  onSaveScheduleTemplate?: (name: string, items: import('../types').ScheduleTemplateItem[]) => void;
  onDeleteScheduleTemplate?: (id: string) => void;
  /**
   * Duplicating and deleting the show. These were only ever on the show card,
   * as two small buttons on every row — which on a phone put a delete control
   * inside a list you scroll with your thumb. The card hides them at phone
   * width now, so they have to be reachable from the show itself.
   */
  onDuplicate?: (id: string) => void;
  /** Book this show again on the given dates — a weekly room, a monthly. */
  onRepeat?: (id: string, dates: string[]) => void;
  onDelete?: (id: string) => void;
}

/** A date on the repeat list: the weekday leads, since that is what is checked. */
function formatRepeatDate(iso: string): string {
  const date = parseShowDate(iso);
  if (!date) return iso;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const STATUS_LABELS: Record<ShowStatus, string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function LineupPreview({ performer, onOpen }: { performer: Performer; onOpen: () => void }) {
  const photo = useMediaUrl(performer.photo);
  return <button className="show-workspace__person" onClick={onOpen} aria-label={`Open ${performer.name}'s profile`}>
    {photo ? <img src={photo} alt="" /> : <span className="show-workspace__initial">{performer.name.charAt(0).toUpperCase()}</span>}
    <span><strong>{performer.name}</strong>{performer.socialMedia && <small>{performer.socialMedia}</small>}{performer.walkOnMusicName && <small>{performer.walkOnMusicName}</small>}{!performer.socialMedia && !performer.walkOnMusicName && <small>Edit profile & headshot</small>}</span>
    <Icon name="edit" size={15} />
  </button>;
}

export function ShowDetail({
  show,
  settings,
  startInRunShow = false,
  onBack,
  onUpdate,
  onSaveToRolodex,
  session,
  onUpdateSettings,
  onSaveScheduleTemplate,
  onDeleteScheduleTemplate,
  onDuplicate,
  onRepeat,
  onDelete,
}: ShowDetailProps) {
  const { confirm, confirmDialog } = useConfirm();
  // Everyone this producer has on file. The show's own bill comes first so a
  // name spelled slightly differently in the Rolodex doesn't win over the
  // spelling actually used on this lineup.
  // The host comes first for the same reason they lead the attach picker: a run
  // sheet says "Host intro — Jo Park" more often than it names anyone else, and
  // that line should fill in who's on stage without being typed twice.
  const knownNames = useMemo(
    () => [
      ...(show.host ? [show.host] : []),
      ...show.performers.map((p) => p.name),
      ...(show.artists ?? []).map((a) => a.name),
      ...settings.potentialComics.map((c) => c.name),
    ].filter((n) => n?.trim()),
    [show.host, show.performers, show.artists, settings.potentialComics],
  );
  /**
   * The show as it is *now*, for anything that resolves after an await.
   *
   * Every section funnels its edits through handleUpdate, which merges them
   * into the show. Merging into the render-time prop meant an operation that
   * started before an edit and finished after it — a photo or an audio upload,
   * a confirmation still waiting to be answered — wrote back a copy of the show
   * from before that edit, and the edit was gone. The longer the upload, the
   * more work it took with it.
   */
  const showRef = useRef(show);
  /**
   * Catch up on signatures before the bill claims nobody is booked.
   *
   * Nothing tells the app when a link is signed — the signer's browser writes
   * a row and walks off — and the lineup now says "Not booked" against anyone
   * without one. Left unchecked that reads as a lie the moment somebody signs:
   * the producer opens the show, sees five people not booked, and has no idea
   * the app simply has not looked. So it looks, here, when they open the show.
   *
   * Only when something is actually outstanding: an account whose contracts
   * are all signed has nothing to ask the server about.
   */
  useEffect(() => {
    const requests = settings.signatureRequests ?? [];
    if (!onUpdateSettings || !requests.some((r) => !r.signed)) return;
    let cancelled = false;
    (async () => {
      const updated = await refreshSignatures(requests);
      if (cancelled) return;
      // The headshot on a signed contract is filed here as well, not only on
      // the Contracts page — this is where the producer most often finds out
      // someone has signed, and the face has to arrive with the signature.
      const filed = await fileSignedHeadshots(updated ?? requests, settings.potentialComics, uploadMedia);
      if (cancelled) return;
      if (filed) onUpdateSettings({ ...settings, ...filed });
      else if (updated) onUpdateSettings({ ...settings, signatureRequests: updated });
    })();
    return () => { cancelled = true; };
    // On open, not on every settings write: finding a signature writes settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.id]);

  useEffect(() => {
    showRef.current = show;
  }, [show]);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());
  const [previewPerformerId, setPreviewPerformerId] = useState<string | undefined>();
  const [editingShowName, setEditingShowName] = useState(false);
  const [runShowOpen, setRunShowOpen] = useState(startInRunShow);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerNoteDraft, setViewerNoteDraft] = useState('');
  const [viewerCopied, setViewerCopied] = useState(false);
  const [viewerCopyFailed, setViewerCopyFailed] = useState(false);
  const viewerUrlRef = useRef<HTMLInputElement>(null);
  const [tempShowName, setTempShowName] = useState(show.name);
  // Adding and removing sections happens in one deliberate place, so a stray tap
  // next to the expand chevron can't wipe a section off the show.
  const [manageSectionsOpen, setManageSectionsOpen] = useState(false);
  /** The repeat sheet, and what it is currently offering to book. */
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [repeatPattern, setRepeatPattern] = useState<RecurrencePattern>('weekly');
  const [repeatCount, setRepeatCount] = useState(4);

  /**
   * Whether the navigation bar is showing the show's name.
   *
   * It swaps in once the page's own big title has passed underneath the bar,
   * so a bar stuck to the top of a long show page still says where you are.
   *
   * Measured against the two elements rather than a scroll threshold: the
   * header's height depends on how long the name is and whether there's a
   * venue, and the bar's offset depends on the safe-area inset. Comparing the
   * rectangles is exact on every phone; a magic number is right on one.
   */
  const topbarRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const [titleInBar, setTitleInBar] = useState(false);

  useEffect(() => {
    let frame = 0;
    function check() {
      frame = 0;
      const hero = heroRef.current;
      const bar = topbarRef.current;
      if (!hero || !bar) return;
      setTitleInBar(hero.getBoundingClientRect().bottom < bar.getBoundingClientRect().bottom);
    }
    // Coalesced to one read per frame: scroll fires far faster than paint, and
    // this measures layout, which is the expensive kind of read to repeat.
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(check);
    }
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Lets the overview tiles act as a table of contents: tap "12 Performers"
  // and land inside the Performers section instead of scrolling to find it.
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  function jumpToSection(sectionKey: string, performerId?: string) {
    setPreviewPerformerId(performerId);
    setExpandedSections((prev) => (prev.has(sectionKey) ? prev : new Set(prev).add(sectionKey)));
    // Two frames: one for React to commit the newly-expanded section, one for
    // the browser to lay it out, so the scroll targets the section's real
    // height instead of the collapsed one it had before this click.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sectionRefs.current[sectionKey]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // Keep the public viewer's pre-show lineup current: whenever an upcoming show's
  // lineup or details change, re-publish the scheduled payload (debounced). Skipped
  // while running so it never clobbers the live on-stage state RunShow publishes.
  useEffect(() => {
    if (!show.viewToken || show.status !== 'upcoming' || runShowOpen) return;
    const timeout = setTimeout(() => {
      if (session) {
        publishLiveView(show.viewToken!, buildScheduledPayload(show.viewNote), session).catch(() => {});
      }
    }, 1000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.viewToken, show.status, runShowOpen, show.name, show.date, show.time, show.viewNote, show.performers, session]);

  // Show the recap once the show is done — either explicitly marked completed
  // or its date has passed. By local day: `new Date('YYYY-MM-DD')` is UTC
  // midnight, which put the recap on the page all show day west of Greenwich.
  const showDay = parseShowDate(show.date);
  const datePassed = !!showDay && daysUntil(showDay, new Date()) < 0;
  const isPastShow = datePassed || show.status === 'completed';

  /**
   * DJ songs that will have a button on the night.
   *
   * Hiding the DJ section used to drop the whole list on the way into Run Show,
   * on the reasoning that a show without a DJ section has no DJ part to run.
   * But hiding a section is about clutter while you're planning, and the songs
   * don't go anywhere — so a producer who tidied the page away found their
   * uploaded tracks had no buttons on the night, with nothing on screen saying
   * why. Only a song someone deliberately uploaded a file for gets a pad
   * (buildSoundboard drops the rest), so surfacing them can't conjure a bank
   * out of a section nobody filled in.
   */
  /**
   * The DJ list this show actually runs on: its own songs plus the whole music
   * library. Everything that reads the list — the section, the readiness
   * count, Run Show's soundboard, the exports — reads this one, so a library
   * track is present in all of them or none.
   */
  const djSongs = useMemo(
    () => showDJSongs(show, settings.musicLibrary ?? []),
    [show, settings.musicLibrary],
  );
  const runnableDJSongs = djSongs;

  function openViewer() {
    setViewerNoteDraft(show.viewNote ?? '');
    setViewerCopied(false);
    setViewerCopyFailed(false);
    setViewerOpen(true);
  }

  /**
   * Book someone off the Rolodex onto this show, and hand their new record
   * back so a cue can link to it.
   *
   * Everything the Rolodex holds comes with them — most importantly the
   * walk-on, which is the whole reason a cue links to a performer rather than
   * just naming one in text.
   */
  function bookFromRolodex(comic: PotentialComic): Performer {
    const performer = comicToPerformer(comic);
    handleUpdate({ performers: [...show.performers, performer] });
    return performer;
  }

  // Everyone on file who isn't already on this bill — matched on name, since a
  // performer booked from the Rolodex is a copy rather than a reference.
  const unbookedComics = useMemo(() => {
    const onBill = new Set(show.performers.map((p) => p.name.trim().toLowerCase()));
    return settings.potentialComics.filter((c) => !onBill.has(c.name.trim().toLowerCase()));
  }, [settings.potentialComics, show.performers]);

  const rolodexTerm = getRolodexTerm(settings);
  /**
   * Names to suggest under the Host field, each carrying where it came from.
   *
   * A datalist can't group its options the way the old select's optgroups did,
   * but an option's `label` renders beside its value — so "on this show" or
   * the Rolodex's own term travels with each name instead of being a heading
   * above a block of them. The bill still comes first, and wins on a duplicate:
   * a name on both lists is someone already booked.
   */
  const hostSuggestions = useMemo(() => {
    const picks = hostChoices(show.performers, show.artists, settings.potentialComics);
    const seen = new Set<string>();
    const out: { name: string; from: string }[] = [];
    for (const [names, from] of [
      [picks.onBill, 'on this show'],
      [picks.rolodex, rolodexTerm.singular.toLowerCase()],
    ] as const) {
      for (const name of names) {
        const key = name.trim().toLowerCase();
        if (key && !seen.has(key)) {
          seen.add(key);
          out.push({ name, from });
        }
      }
    }
    return out;
  }, [show.performers, show.artists, settings.potentialComics, rolodexTerm]);
  const hostListId = `show-host-options-${show.id}`;
  const repeatDates = useMemo(
    () => (repeatOpen && show.date ? recurringDates(show.date, repeatPattern, repeatCount) : []),
    [repeatOpen, show.date, repeatPattern, repeatCount],
  );
  /**
   * The picker under the Host field.
   *
   * A datalist is invisible on most phones — it only appears once you have
   * typed enough of a name to match, which is no use when the whole point is
   * not remembering how the name is spelled. So the same names are also a
   * list you can open and tap.
   */
  const [hostPicking, setHostPicking] = useState(false);

  function handleScenesChange(scenes: Scene[]) {
    onUpdate({ ...show, scenes });
  }

  function handleUpdate(updates: Partial<Show>) {
    const base = showRef.current;
    const merged = { ...base, ...updates };

    // Auto-add walk-on music to DJ list when performers/artists get new songs
    if (updates.performers || updates.artists) {
      const previousPerformers = base.performers;
      const previousArtists = base.artists;
      const newPerformers = merged.performers;
      const newArtists = merged.artists;
      const newDJSongs = [...merged.djSongs];

      for (const p of newPerformers) {
        const prev = previousPerformers.find((pp) => pp.id === p.id);
        if (p.walkOnMusicName && p.walkOnMusicName !== prev?.walkOnMusicName) {
          const alreadyExists = newDJSongs.some(
            (s) => s.notes === `Walk-on: ${p.name}`,
          );
          if (!alreadyExists) {
            newDJSongs.push({
              id: generateId(),
              title: p.walkOnMusicName.replace(/\.[^.]+$/, ''),
              artist: p.name,
              notes: `Walk-on: ${p.name}`,
            });
          }
        }
      }

      for (const a of newArtists) {
        const prev = previousArtists.find((pa) => pa.id === a.id);
        if (a.walkOnMusicName && a.walkOnMusicName !== prev?.walkOnMusicName) {
          const alreadyExists = newDJSongs.some(
            (s) => s.notes === `Walk-on: ${a.name}`,
          );
          if (!alreadyExists) {
            newDJSongs.push({
              id: generateId(),
              title: a.walkOnMusicName.replace(/\.[^.]+$/, ''),
              artist: a.name,
              notes: `Walk-on: ${a.name}`,
            });
          }
        }
      }

      merged.djSongs = newDJSongs;
    }

    // Two edits in the same tick — the generator writing a running order and
    // the start time it was timed from — both read this ref before React has
    // re-rendered, so without this the second silently threw the first away.
    // The show as we last knew it is the one we are about to send.
    showRef.current = merged;
    onUpdate(merged);
  }

  function handleHideSection(sectionKey: SectionKey) {
    const hidden = show.hiddenSections || [];
    if (!hidden.includes(sectionKey)) {
      onUpdate({ ...show, hiddenSections: [...hidden, sectionKey] });
    }
  }

  function handleRestoreSection(sectionKey: SectionKey) {
    const hidden = (show.hiddenSections || []).filter(k => k !== sectionKey);
    const updates: Partial<Show> = { hiddenSections: hidden };
    // Adding Scenes is what brings the list into being. Until a producer asks
    // for it, `scenes` stays undefined and the section stays out of the way —
    // see isSectionHidden.
    if (sectionKey === 'scenes' && show.scenes === undefined) updates.scenes = [];
    onUpdate({ ...show, ...updates });
  }

  /**
   * Whether a section is off for this show.
   *
   * Every section but one is opt-out: present unless the producer removed it.
   * Scenes is opt-in, because the page otherwise asks for the running order
   * twice — Schedule holds the cues that Run Show and the public viewer read,
   * while Scenes is a separate list nothing else on the night uses. Sitting
   * open and empty at the bottom of every show, it read as a section the
   * producer had failed to fill in.
   *
   * `scenes: undefined` is the signal for "never used". An array — even an
   * empty one — means the producer added the section, so it survives a reload
   * before they've written the first scene. No schema change needed.
   */
  function isSectionHidden(sectionKey: SectionKey): boolean {
    if ((show.hiddenSections || []).includes(sectionKey)) return true;
    if (sectionKey === 'scenes') return show.scenes === undefined;
    return false;
  }

  function toggleSection(sectionKey: string) {
    setPreviewPerformerId(undefined);
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionKey)) {
      newExpanded.delete(sectionKey);
    } else {
      newExpanded.add(sectionKey);
    }
    setExpandedSections(newExpanded);
  }

  function handleSaveShowName() {
    if (tempShowName.trim()) {
      onUpdate({ ...show, name: tempShowName.trim() });
      setEditingShowName(false);
    }
  }

  function handleEditShowName() {
    setTempShowName(show.name);
    setEditingShowName(true);
  }

  function buildStartsAtISO(): string | undefined {
    return showStartISO(show.date, show.time);
  }

  function viewerUrl(token: string): string {
    // Carries this show's audio key in the fragment once Run Show has published
    // a board to the viewer — without it the viewer can still show the running
    // order, it just can't decode the music. The fragment never leaves the
    // browser, so the server storing that audio still can't read it.
    return buildViewerUrl(window.location.origin, token, loadViewerKey(token));
  }

  // The lineup the public viewer shows pre-show — performers in their list order.
  function buildLineup(): LiveViewPayload['lineup'] {
    return show.performers.map((p) => ({
      name: p.name,
      credits: p.credits,
    }));
  }

  function buildScheduledPayload(note: string | undefined): LiveViewPayload {
    return {
      showName: show.name,
      status: 'scheduled',
      startsAt: buildStartsAtISO(),
      note: note?.trim() || undefined,
      theme: loadColorScheme(),
      lineup: buildLineup(),
      lastUpdateMs: Date.now(),
    };
  }

  async function handleSaveViewer() {
    let token = show.viewToken;
    let updates: Partial<Show> = { viewNote: viewerNoteDraft.trim() || undefined };
    if (!token) {
      token = generateId();
      updates = { ...updates, viewToken: token };
    }
    onUpdate({ ...show, ...updates });
    try {
      if (session) await publishLiveView(token, buildScheduledPayload(viewerNoteDraft), session);
    } catch { /* ignore */ }
  }

  function handleCopyViewer() {
    const token = show.viewToken;
    if (!token) return;
    const url = viewerUrl(token);
    navigator.clipboard?.writeText(url).then(() => {
      setViewerCopyFailed(false);
      setViewerCopied(true);
      setTimeout(() => setViewerCopied(false), 1800);
    }).catch(() => {
      // The link is already on screen, in a read-only field an inch away. The
      // old fallback opened a window.prompt to show the same string again —
      // a blocking dialog, in the one situation most likely to be the
      // installed app, where blocking dialogs are what hang the page. Select
      // the field it's already in instead.
      setViewerCopyFailed(true);
      const field = viewerUrlRef.current;
      field?.focus();
      field?.select();
    });
  }

  function handleAddTodoText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const todo: TodoItem = {
      id: generateId(),
      text: trimmed,
      completed: false,
    };
    onUpdate({ ...show, todos: [...(show.todos || []), todo] });
  }

  function handleToggleTodo(todoId: string) {
    const todos = (show.todos || []).map((t) =>
      t.id === todoId ? { ...t, completed: !t.completed } : t
    );
    onUpdate({ ...show, todos });
  }

  async function handleDeleteTodo(todoId: string) {
    const todo = (show.todos || []).find((t) => t.id === todoId);
    if (await confirm(`Delete to-do "${todo?.text}"? This cannot be undone.`)) {
      const todos = (show.todos || []).filter((t) => t.id !== todoId);
      onUpdate({ ...show, todos });
    }
  }

  const sections = [
    {
      key: 'performers',
      sectionKey: 'performers' as SectionKey,
      title: 'Performers',
      subtitle: 'Names, walk-on music, and social media.',
      accent: 'rose',
      count: show.performers.length,
      preview: joinNames(show.performers.map((p) => p.name)),
      content: <PerformersSection
        key={previewPerformerId ?? "lineup"}
        initialPerformerId={previewPerformerId}
        performers={show.performers}
        potentialComics={settings.potentialComics}
        showName={show.name}
        performerTarget={show.performerTarget}
        onSaveToRolodex={onSaveToRolodex}
        onChange={(performers) => handleUpdate({ performers })}
        onTargetChange={(performerTarget) => handleUpdate({ performerTarget })}
        onAnnounce={() => setAnnounceOpen(true)}
        contractStatus={
          settings.contracts?.length
            ? (performer) => signerStatus(settings.signatureRequests ?? [], performer.name, performer.comicId)
            : undefined
        }
        renderContracts={
          session && onUpdateSettings
            ? (performer) => (
                <PerformerContracts
                  performerName={performer.name}
                  performerComicId={performer.comicId}
                  performerEmail={performer.email}
                  settings={settings}
                  session={session}
                  show={{
                    showName: show.name,
                    date: show.date,
                    time: show.time,
                    venueName: show.venueName,
                    location: show.location,
                  }}
                  onUpdateSettings={onUpdateSettings}
                />
              )
            : undefined
        }
      />,
    },
    {
      key: 'artists',
      sectionKey: 'artists' as SectionKey,
      title: 'Artists',
      subtitle: 'Artist entries with name, type, and music.',
      accent: 'magenta',
      count: show.artists.length,
      preview: joinNames(show.artists.map((a) => a.name)),
      content: <ArtistsSection
        artists={show.artists}
        potentialComics={settings.potentialComics}
        onChange={(artists) => handleUpdate({ artists })}
      />,
    },
    {
      key: 'schedule',
      sectionKey: 'schedule' as SectionKey,
      title: 'Schedule',
      subtitle: 'Timeline of events with times and descriptions.',
      accent: 'blue',
      count: show.schedule.length,
      preview: scheduleSummary(show.schedule),
      content: <ScheduleSection
        schedule={show.schedule}
        showName={show.name}
        showTime={show.time}
        performers={show.performers}
        host={show.host}
        knownNames={knownNames}
        unbookedComics={unbookedComics}
        onBookPerformer={bookFromRolodex}
        onChange={(schedule) => handleUpdate({ schedule })}
        djSongs={djSongs}
        templates={settings.scheduleTemplates}
        onSaveTemplate={onSaveScheduleTemplate}
        onDeleteTemplate={onDeleteScheduleTemplate}
      />,
    },
    {
      key: 'dj',
      sectionKey: 'dj' as SectionKey,
      title: 'DJ Music',
      subtitle: 'Songs and notes for the DJ.',
      accent: 'teal',
      count: djSongs.length,
      preview: joinNames(djSongs.map((song) => song.title)),
      content: (
        <DJMusicSection

          show={show}
          library={settings.musicLibrary ?? []}
          onUpdate={handleUpdate}
        />
      ),
    },
    {
      key: 'staff',
      sectionKey: 'staff' as SectionKey,
      title: 'Staff',
      subtitle: 'Roles and assignments for production staff.',
      accent: 'amber',
      count: show.staff.length,
      preview: staffSummary(show.staff),
      content: <StaffSection staff={show.staff} onChange={(staff) => handleUpdate({ staff })} />,
    },
    {
      key: 'vendors',
      sectionKey: 'vendors' as SectionKey,
      title: 'Vendors',
      subtitle: 'Build a profile for each vendor — contact, cost, and notes.',
      accent: 'green',
      count: (show.vendors || []).length,
      preview: vendorsSummary(show.vendors || []),
      content: <VendorsSection vendors={show.vendors || []} onChange={(vendors) => handleUpdate({ vendors })} />,
    },
    {
      key: 'scenes',
      sectionKey: 'scenes' as SectionKey,
      title: 'Scenes & Segments',
      subtitle: 'A separate list of scenes, for shows built in blocks rather than cues.',
      accent: 'violet',
      count: (show.scenes ?? []).length,
      content: <SceneList scenes={show.scenes ?? []} onChange={handleScenesChange} />,
    },
    // Last, not first. The header already prints the date, time, venue and
    // location, so this is where you *change* them rather than where you read
    // them — and that happens once, at setup. Everything you open a show to
    // work on sits above it.
    {
      key: 'basic',
      sectionKey: 'basic' as SectionKey,
      title: 'Basic Info',
      subtitle: 'Date, time, location, and venue.',
      accent: 'slate',
      content: <BasicInfoSection show={show} onChange={handleUpdate} />,
    },
  ];

  // Add recap section for past shows
  if (isPastShow) {
    sections.push({
      key: 'recap',
      sectionKey: 'recap' as SectionKey,
      title: 'Recap',
      subtitle: 'Attendance, sales, performer notes, and lessons learned.',
      accent: 'slate',
      content: (
        <ShowRecapSection
          recap={show.recap}
          expenses={show.expenses}
          todos={show.todos || []}
          onChange={(recap) => handleUpdate({ recap })}
          onAddTodo={handleAddTodoText}
          onToggleTodo={handleToggleTodo}
          onDeleteTodo={handleDeleteTodo}
        />
      ),
    });
  }

  // Which of the sections above are actually on the page right now, so a
  // tile only offers to jump somewhere that exists — a section the producer
  // hid stays hidden rather than reappearing because its tile was tapped.
  const visibleSections = sections.filter((section) => !isSectionHidden(section.sectionKey));
  const scheduleSection = visibleSections.find(section => section.key === 'schedule');
  // Date and time are written the same way here as on the show cards, so the
  // same show doesn't read as "9/18/2026 20:00" in one place and
  // "Sep 18 · 8:00 PM" in another.
  const detailDate = parseShowDate(show.date);
  const metaParts: { text: string; kind: 'when' | 'place' }[] = [
    {
      text: detailDate?.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: detailDate.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
      }),
      kind: 'when' as const,
    },
    { text: formatShowTime(show.time), kind: 'when' as const },
    { text: show.venueName, kind: 'place' as const },
    { text: show.location, kind: 'place' as const },
  ].filter((part): part is { text: string; kind: 'when' | 'place' } => !!part.text);

  // Every secondary action for this show, in one menu attached to the show —
  // rather than scattered across the app's navigation.
  const moreItems: MoreMenuItem[] = [
    { label: 'Viewer link', onSelect: openViewer },
    { label: 'Export PDF', onSelect: () => exportShowToPDF(show, settings) },
    { label: 'Add or remove sections', onSelect: () => setManageSectionsOpen(true) },
  ];

  if (onDuplicate) {
    moreItems.push({
      label: 'Duplicate show',
      // Back to the list, because the copy is a different show from the one
      // you're looking at and it lands at the top of the grid.
      onSelect: () => { onDuplicate(show.id); onBack(); },
    });
  }

  if (onRepeat) {
    moreItems.push({
      label: 'Repeat this show…',
      onSelect: () => setRepeatOpen(true),
    });
  }

  if (onDelete) {
    moreItems.push({
      label: 'Delete show',
      danger: true,
      onSelect: async () => {
        const ok = await confirm({
          title: `Delete "${show.name}"?`,
          message: 'It will be moved to trash, where you can recover it.',
        });
        if (ok) { onDelete(show.id); onBack(); }
      },
    });
  }

  function renderSection(section: typeof sections[number]) {
    const isExpanded = expandedSections.has(section.key);
    const panelId = `show-section-panel-${section.key}`;
    const buttonId = `show-section-header-${section.key}`;
    const filled = typeof section.count === 'number' && section.count > 0;

    return (
      <section
        key={section.key}
        ref={(el) => {
          sectionRefs.current[section.key] = el;
        }}
        className={`accordion-section show-workspace__card show-workspace__card--${section.key}${isExpanded ? ' show-workspace__card--open' : ''}`}
      >
        {/* The whole header is one button, wrapped in the heading. It used
            to be a div with a click handler and a separate arrow button,
            so the only thing a keyboard could reach was the arrow — the
            large obvious target was mouse-only. */}
        <h2 className="accordion-section__heading">
          <button
            type="button"
            id={buttonId}
            className="accordion-section__header"
            onClick={() => toggleSection(section.key)}
            aria-expanded={isExpanded}
            aria-controls={panelId}
          >
            <span className={`accordion-section__icon accent--${section.accent}`}>
              <Icon name={SECTION_ICONS[section.key] ?? 'file'} size={18} />
            </span>
            <span className="accordion-section__header-left">
              <span className="accordion-section__title-row">
                <span className="accordion-section__title">{section.title}</span>
                {filled && (
                  <span className="accordion-section__count">
                    {section.count}
                    <span className="visually-hidden"> added</span>
                  </span>
                )}
              </span>
              {/* One line under the title, doing the most useful job it
                  can: what's actually in there once the section has
                  content, and what belongs there while it's empty.
                  Hidden when open, where the content itself answers it. */}
              {!isExpanded &&
                (filled ? (
                  section.preview && (
                    <span className="accordion-section__preview">{section.preview}</span>
                  )
                ) : (
                  <span className="accordion-section__subtitle">{section.subtitle}</span>
                ))}
            </span>
            <svg
              className="accordion-section__chevron"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="5 8 10 13 15 8" />
            </svg>
          </button>
        </h2>

        {!isExpanded && section.key === 'performers' && <div className="show-workspace__lineup-preview">
          <LineupActions performers={show.performers} showName={show.name} onAnnounce={() => setAnnounceOpen(true)} />
          {show.performers.length ? <div className="show-workspace__people">{show.performers.map(performer => <LineupPreview key={performer.id} performer={performer} onOpen={() => jumpToSection('performers', performer.id)} />)}</div> : <p>Build the lineup for this show.</p>}
          <button className="btn btn--secondary btn--sm" onClick={() => jumpToSection('performers')}>{show.performers.length ? 'Edit lineup / add performer' : 'Add performers'}</button>
        </div>}
        {!isExpanded && section.key === 'basic'  && <div className="show-workspace__detail-preview">
          <strong>{show.venueName || 'Add a venue'}</strong>
          <span>{show.location || 'Add a location'}</span>
          <span>{detailDate?.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) || 'Set a date'} · {formatShowTime(show.time) || 'Set a time'}</span>
          <button className="btn btn--secondary btn--sm" onClick={() => jumpToSection('basic')}>Edit show details</button>
        </div>}
        {isExpanded && (
          <div
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            className="accordion-section__content"
          >
            {section.content}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="show-detail show-workspace">
      <aside className="show-workspace__sidebar" aria-label="Show navigation">
        <div className="show-workspace__brand"><BrandMark /><span>I Can Run A Show</span></div>
        <button className="show-workspace__nav-back" onClick={onBack}>← All shows</button>
        <nav aria-label="Show sections">
          <button onClick={() => { setExpandedSections(new Set()); setPreviewPerformerId(undefined); heroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><Icon name="file" size={17} />Overview</button>
          {visibleSections.map(section => <button key={section.key} aria-expanded={expandedSections.has(section.key)} aria-controls={`show-section-panel-${section.key}`} onClick={() => jumpToSection(section.key)}>
            <Icon name={SECTION_ICONS[section.key] ?? 'file'} size={17} />{section.title}
          </button>)}
        </nav>
        <button className="show-workspace__configure" onClick={() => setManageSectionsOpen(true)}>Add or remove sections</button>
      </aside>
      <div className="show-workspace__body">
      {/* Outside the hero, not inside it. A sticky element can only stick
          within its own containing block, and the hero is 185px tall — so
          nested in there the bar unstuck itself almost immediately and rode
          the page up like everything else. Out here its containing block is
          the whole show page. */}
      <div
        className={`show-detail__topbar${titleInBar ? ' show-detail__topbar--titled' : ''}`}
        ref={topbarRef}
      >
          {/* The visible "Shows" label is hidden on narrow phones (see the CSS),
              so the button carries its own name for assistive tech. */}
          <button
            type="button"
            className="show-detail__back-btn"
            onClick={onBack}
            aria-label="Back to shows"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M12.707 4.293a1 1 0 010 1.414L8.414 10l4.293 4.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span>Shows</span>
          </button>
          {/* Once the page's own big title has scrolled past, its name appears
              here instead, so a bar stuck to the top of a long show page still
              says which show you are in. The gap it fills was the spacer the
              old save indicator used to occupy.

              aria-hidden because the page's <h1> is the real title and is
              still in the document — this is the same words a second time,
              which a screen reader has no use for. */}
          <div
            className={`show-detail__topbar-title${titleInBar ? ' show-detail__topbar-title--shown' : ''}`}
            aria-hidden="true"
          >
            {show.name}
          </div>
          <button
            className="show-detail__run-show"
            onClick={() => setRunShowOpen(true)}
            title="Run the live show"
          >
            <Icon name="play" size={14} />
            Run Show
          </button>
          <MoreMenu label="More show actions" items={moreItems} />
        </div>

      <div className="show-detail__hero">
        <div className="show-detail__header" ref={heroRef}>
          {editingShowName ? (
            <div className="show-detail__name-edit">
              {/* The page keeps exactly one h1 whether or not the name is being
                  edited, so the document outline never changes underfoot. */}
              <h1 className="visually-hidden">{tempShowName || show.name}</h1>
              <input
                className="section-field__input show-detail__name-input"
                value={tempShowName}
                onChange={(e) => setTempShowName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveShowName();
                  if (e.key === 'Escape') setEditingShowName(false);
                }}
                placeholder="Show name"
                aria-label="Show name"
                autoFocus
              />
              <button className="btn btn--primary btn--sm" onClick={handleSaveShowName}>
                Save
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setEditingShowName(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <h1 className="show-detail__title">{show.name}</h1>
              <button
                className="show-detail__name-edit-btn"
                onClick={handleEditShowName}
                aria-label={`Edit show name, currently ${show.name}`}
              >
                <Icon name="edit" size={14} aria-hidden />
                <span>Edit</span>
              </button>
            </>
          )}
          <select
            className={`show-detail__status show-detail__status--select show-detail__status--${show.status}`}
            value={show.status}
            onChange={(e) => {
              onUpdate({ ...show, status: e.target.value as ShowStatus });
            }}
            aria-label="Show status"
            title="Change show status"
          >
            {(Object.keys(STATUS_LABELS) as ShowStatus[]).map((status) => (
              <option key={status} value={status}>{STATUS_LABELS[status]}</option>
            ))}
          </select>
          {/* On the same line as the status rather than a row of its own: both
              are facts about the show, and stacking them pushed the first real
              content another line down the phone. */}
          {metaParts.length > 0 && (
            <div className="show-detail__meta">
              {metaParts.map((part) => (
                <span
                  key={part.text}
                  className={part.kind === 'place' ? 'show-detail__meta-place' : undefined}
                >
                  {part.text}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`show-workspace__columns${scheduleSection ? '' : ' show-workspace__columns--without-schedule'}`}>
      {scheduleSection && <aside className="show-workspace__running" aria-label="Running order">
        <div className="show-workspace__running-head">
          <h2>{detailDate?.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) || 'Show day'}</h2>
          <p>Running order</p>
        </div>
        {renderSection(scheduleSection)}
        {!expandedSections.has('schedule') && <>
        {show.schedule.length > 0 && <ShowTimeline schedule={show.schedule} showTime={show.time} />}
        {show.schedule.length ? <ol>
          {show.schedule.map((cue, index) => <li key={cue.id}>
            <span className="show-workspace__cue-number">{String(index + 1).padStart(2, '0')}</span>
            <button onClick={() => jumpToSection('schedule')}>
              <time>{cue.time || `Cue ${index + 1}`}</time>
              <strong>{cue.description || 'Untitled cue'}</strong>
              {cue.performer && <span>{cue.performer}</span>}
              {cue.durationMin != null && <small>{cue.durationMin} min</small>}
            </button>
          </li>)}
        </ol> : <div className="show-workspace__running-empty"><Icon name="schedule" size={28} /><h3>Plan the night</h3><p>Add cues or build a running order from your lineup.</p></div>}
        <button className="btn btn--primary" onClick={() => jumpToSection('schedule')}>{show.schedule.length ? 'Edit schedule' : 'Build schedule'}</button>
        </>}
      </aside>}
      <div className="show-detail__sections-accordion">
      {/* Host — one row, not two.
          The name field and a "Pick someone…" select used to sit side by side,
          and on a phone the select dropped to a full-width line of its own
          (its label was being cut to "Use a performe" otherwise). Two rows of
          chrome for one optional field, directly above the lineup.

          A datalist folds the picker back into the field: type, or pick from
          the same names. The one loss is the On this show / Rolodex grouping,
          which a datalist can't render — so the bill is listed first, where
          the host almost always comes from. */}
      <div className="show-detail__host">
        <label className="show-detail__host-label" htmlFor="show-host-input">Host</label>
        <input
          id="show-host-input"
          type="text"
          className="section-field__input show-detail__host-input"
          placeholder="Host name"
          list={hostListId}
          value={show.host || ''}
          onChange={(e) => onUpdate({ ...show, host: e.target.value || undefined })}
        />
        {hostSuggestions.length > 0 && (
          <>
            <datalist id={hostListId}>
              {hostSuggestions.map((pick) => (
                <option key={pick.name} value={pick.name} label={pick.from} />
              ))}
            </datalist>
            <button
              type="button"
              className="btn btn--secondary btn--sm show-detail__host-pick"
              aria-expanded={hostPicking}
              onClick={() => setHostPicking((v) => !v)}
            >
              {hostPicking ? 'Close' : `Pick from ${rolodexTerm.plural.toLowerCase()}`}
            </button>
          </>
        )}
        {hostPicking && (
          <div className="show-detail__host-list">
            {hostSuggestions.map((pick) => (
              <button
                key={pick.name}
                type="button"
                className="show-detail__host-option"
                onClick={() => {
                  onUpdate({ ...show, host: pick.name });
                  setHostPicking(false);
                }}
              >
                <span className="show-detail__host-option-name">{pick.name}</span>
                <span className="show-detail__host-option-from">{pick.from}</span>
              </button>
            ))}
            {show.host && (
              <button
                type="button"
                className="show-detail__host-option show-detail__host-option--clear"
                onClick={() => {
                  onUpdate({ ...show, host: undefined });
                  setHostPicking(false);
                }}
              >
                Clear the host
              </button>
            )}
          </div>
        )}
      </div>

        <section className="show-workspace__notes">
          <h2>Production notes</h2>
          <label className="visually-hidden" htmlFor="show-production-notes">Production notes</label>
          <textarea id="show-production-notes" placeholder="Reminders for this show, soundcheck, setup…"
            value={show.productionNotes ?? ''} onChange={e => handleUpdate({ productionNotes: e.target.value })} />
          <span>Saved with this show</span>
        </section>

        {visibleSections.filter(section => section.key !== 'schedule').map(renderSection)}
      </div>


      </div>
      <button className="btn btn--secondary show-workspace__mobile-manage" onClick={() => setManageSectionsOpen(true)}>Add or remove sections</button>
      </div>

      {runShowOpen && (
        <RunShow
          showName={show.name}
          showId={show.id}
          viewToken={show.viewToken}
          schedule={show.schedule}
          performers={show.performers}
          djSongs={runnableDJSongs}
          libraryCount={(settings.musicLibrary ?? []).length}
          musicLibrary={settings.musicLibrary ?? []}
          remoteKey={settings.remoteMusicKey}
          session={session}
          onStart={() => {
            if (show.status !== 'completed' && show.status !== 'in-progress') {
              onUpdate({ ...show, status: 'in-progress' });
            }
          }}
          onFinish={() => onUpdate({ ...show, status: 'completed' })}
          onClose={() => setRunShowOpen(false)}
        />
      )}

      {repeatOpen && onRepeat && (
        <Modal onClose={() => setRepeatOpen(false)} labelledBy="repeat-show-title">
          <div className="repeat-show">
            <h2 id="repeat-show-title" className="repeat-show__title">Repeat this show</h2>
            {!show.date ? (
              <p className="repeat-show__sub">
                Give this show a date first — the run is worked out from it.
              </p>
            ) : (
              <>
                <p className="repeat-show__sub">
                  Books more nights of “{show.name}”, each a copy of this one: the same venue,
                  running order and an empty performer lineup, on the dates below.
                  Book performers separately for each night. Changing one show changes only that night.
                </p>

                <label className="repeat-show__field">
                  <span>How often</span>
                  <select
                    className="section-field__input"
                    value={repeatPattern}
                    onChange={(e) => setRepeatPattern(e.target.value as RecurrencePattern)}
                  >
                    {(Object.keys(RECURRENCE_LABELS) as RecurrencePattern[]).map((p) => (
                      <option key={p} value={p}>{RECURRENCE_LABELS[p]}</option>
                    ))}
                  </select>
                </label>

                <label className="repeat-show__field">
                  <span>How many more</span>
                  <input
                    className="section-field__input"
                    type="number"
                    min={1}
                    max={MAX_OCCURRENCES}
                    value={repeatCount}
                    onChange={(e) => setRepeatCount(Number(e.target.value))}
                  />
                </label>

                <p className="repeat-show__rule">{describeRecurrence(show.date, repeatPattern)}</p>

                {/* The dates themselves, before anything is booked. A rule is
                    easy to misread; a list of nights is not, and this is the
                    last point at which a wrong one costs nothing. */}
                {repeatDates.length > 0 ? (
                  <ul className="repeat-show__dates">
                    {repeatDates.map((d) => (
                      <li key={d}>{formatRepeatDate(d)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="repeat-show__sub">Choose how many nights to add.</p>
                )}

                <div className="repeat-show__actions">
                  <button className="btn btn--ghost" onClick={() => setRepeatOpen(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn--primary"
                    disabled={repeatDates.length === 0}
                    onClick={() => {
                      onRepeat(show.id, repeatDates);
                      setRepeatOpen(false);
                      onBack();
                    }}
                  >
                    {repeatDates.length === 1 ? 'Add 1 show' : `Add ${repeatDates.length} shows`}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {manageSectionsOpen && (
        <Modal onClose={() => setManageSectionsOpen(false)} labelledBy="manage-sections-title">
          <div className="manage-sections">
            <h2 id="manage-sections-title" className="manage-sections__title">Sections</h2>
            <p className="manage-sections__sub">
              Choose what this show tracks. Removing a section only hides it — nothing you've
              entered is deleted, and it all comes back if you add the section again.
            </p>
            <ul className="manage-sections__list">
              {sections.map((section) => {
                const hidden = isSectionHidden(section.sectionKey);
                const locked = section.sectionKey === 'basic';
                return (
                  <li key={section.key} className="manage-sections__row">
                    <div className="manage-sections__info">
                      <span className="manage-sections__name">{section.title}</span>
                      <span className="manage-sections__desc">{section.subtitle}</span>
                    </div>
                    {locked ? (
                      <span className="manage-sections__always">Always on</span>
                    ) : (
                      <button
                        type="button"
                        className={`btn btn--sm ${hidden ? 'btn--secondary' : 'btn--ghost'}`}
                        onClick={() =>
                          hidden
                            ? handleRestoreSection(section.sectionKey)
                            : handleHideSection(section.sectionKey)
                        }
                      >
                        {hidden ? 'Add' : 'Remove'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="manage-sections__actions">
              <button className="btn btn--primary" onClick={() => setManageSectionsOpen(false)}>Done</button>
            </div>
          </div>
        </Modal>
      )}

      {viewerOpen && (
        <Modal onClose={() => setViewerOpen(false)} labelledBy="viewer-link-modal-title">
          <div className="viewer-link-modal">
            <h2 id="viewer-link-modal-title" className="viewer-link-modal__title">Public viewer link</h2>
            <p className="viewer-link-modal__sub">
              A read-only page anyone with the link can open — shows the timer, who's on stage,
              and who's coming up next. Until the show goes live, it shows the start time and
              your note below.
            </p>

            {show.viewToken ? (
              <div className="viewer-link-modal__url-row">
                <input
                  ref={viewerUrlRef}
                  className="section-field__input"
                  readOnly
                  value={viewerUrl(show.viewToken)}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button className="btn btn--secondary btn--sm" onClick={handleCopyViewer}>
                  {viewerCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            ) : null}
            {show.viewToken && viewerCopyFailed ? (
              <p className="viewer-link-modal__hint" role="status">
                Couldn't reach the clipboard — the link is selected above, so copy it by hand.
              </p>
            ) : (
              <p className="viewer-link-modal__hint">
                Save to generate the link.
              </p>
            )}

            <label className="section-field__label" style={{ marginTop: 14 }}>Pre-show note (optional)</label>
            <textarea
              className="section-field__input"
              rows={4}
              value={viewerNoteDraft}
              onChange={(e) => setViewerNoteDraft(e.target.value)}
              placeholder="e.g. Doors at 7:30 PM · 21+ · BYOB"
              style={{ resize: 'vertical' }}
            />

            <div className="viewer-link-modal__actions">
              <button className="btn btn--primary" onClick={handleSaveViewer}>
                {show.viewToken ? 'Save & publish' : 'Generate link & publish'}
              </button>
              <button className="btn btn--ghost" onClick={() => setViewerOpen(false)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
      {announceOpen && <AnnouncePost show={show} onClose={() => setAnnounceOpen(false)} />}

      {confirmDialog}
    </div>
  );
}
