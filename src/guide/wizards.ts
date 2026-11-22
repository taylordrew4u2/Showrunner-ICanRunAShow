/**
 * The setup wizards on Help & setup, as data.
 *
 * A wizard is a short list of steps. A step says what to do, takes the
 * producer to the real page for it, and knows, from the account itself, when
 * it has been done. Nothing derived is stored: "done" is read from the shows
 * and settings on every render, so it can never disagree with them. Where
 * there is nothing to read, the step has a tick box instead.
 *
 * The sample show never counts towards any step, and nor does anything that
 * is in the account only because of it, such as someone filed in the Rolodex
 * from its lineup during the tour.
 */
import { DEFAULT_SETTINGS, type AppSettings, type PotentialComic, type Show } from '../types';
import { signatureSummary } from '../utils/contracts';
import { rolodexKey } from '../utils/rolodex';
import type { GuidePlace } from './places';
import type { LockedFeature } from './tourSteps';

export type WizardId =
  | 'first-show'
  | 'rolodex'
  | 'contracts'
  | 'live'
  | 'music'
  | 'promo'
  | 'assistants'
  | 'coproducers'
  | 'backup'
  | 'workspace'
  | 'money';

/** What a step's "done" is read from. */
export interface WizardFacts {
  /** The producer's own shows: never the sample. */
  realShows: Show[];
  /** The producer's own Rolodex: never someone filed only from a sample show. */
  comics: PotentialComic[];
  settings: AppSettings;
  /** Co-producer links made. */
  links: number;
  /** When a backup file was last downloaded on this device. */
  lastBackupAt: string | null;
  /** The live board has been opened on this device. */
  ranShow: boolean;
  /** Null until the producer presses "Check connections". */
  assistantConnections: number | null;
}

export interface WizardStep {
  id: string;
  title: string;
  text: string;
  /** Added to the text inside the iOS app. */
  nativeText?: string;
  /** The one button a step may have. `check` asks the server which assistants are connected. */
  action?: { label: string; place?: GuidePlace; targets?: string[]; check?: 'connections' };
  /** Held back on the free plan: the step shows the app's own lock note. */
  locked?: LockedFeature;
  /** Needs the network. Said only while offline. */
  online?: boolean;
  /** Absent when there is nothing to read: the step has a tick box instead. */
  detect?: (facts: WizardFacts) => boolean;
}

export interface Wizard {
  id: WizardId;
  title: string;
  /** The short name on the dock's progress line. */
  short: string;
  description: string;
  /** Hidden in co-producer view: it is about the owner's own account. */
  ownerOnly?: boolean;
  steps: WizardStep[];
}

const t = (id: string) => `[data-tour="${id}"]`;
const REAL: GuidePlace = { view: 'detail', show: 'real' };
const PAGE_TITLE = t('page-title');
const LINEUP: GuidePlace = { view: 'detail', show: 'real', section: 'performers' };
/**
 * The lineup's own tools, else the way to add someone. A show with nobody on
 * it has no Post copy or headshot button yet, and no "Add" toggle either: its
 * name field is already open, and that is the first thing to do.
 */
const LINEUP_TOOLS = [t('lineup-actions'), t('lineup-add'), t('lineup-name'), '#show-section-header-performers'];
const settingsCard = (anchor: string) => ({
  place: { view: 'settings', anchor } as GuidePlace,
  targets: [t(anchor)],
});

export const WIZARDS: readonly Wizard[] = [
  {
    id: 'first-show',
    title: 'Your first show',
    short: 'First show',
    description: 'From an empty list to a night you can run.',
    ownerOnly: true,
    steps: [
      {
        id: 'create',
        title: 'Name it and pick a date',
        text: 'A name and a date are enough to start. You can change both later.',
        action: { label: 'Start a show', place: { view: 'list', newShow: true }, targets: [t('shows-new')] },
        detect: (f) => f.realShows.length > 0,
      },
      {
        id: 'lineup',
        title: 'Add the lineup',
        text: 'Add each performer. They are filed in your Rolodex as you go.',
        action: { label: 'Open the lineup', place: { view: 'detail', show: 'real', section: 'performers' }, targets: [t('lineup-add'), '#show-section-header-performers'] },
        detect: (f) => f.realShows.some((show) => show.performers.length > 0 || (show.artists ?? []).length > 0),
      },
      {
        id: 'schedule',
        title: 'Build the running order',
        text: 'Add cues by hand, or let Generate times lay them out from the lineup.',
        action: { label: 'Open the running order', place: { view: 'detail', show: 'real', section: 'schedule' }, targets: [t('schedule-tools'), '#show-section-header-schedule'] },
        detect: (f) => f.realShows.some((show) => show.schedule.length > 0),
      },
      {
        id: 'sections',
        title: 'Pick the sections you need',
        text: 'Turn on DJ Music, Staff, Vendors or Scenes for this show, or leave them off.',
        action: { label: 'Show me', place: REAL, targets: [t('show-sections'), t('show-more')] },
      },
    ],
  },
  {
    id: 'rolodex',
    title: 'Your Rolodex',
    short: 'Rolodex',
    description: 'Everyone you might book, saved once.',
    steps: [
      {
        id: 'add',
        title: 'Add someone',
        text: 'Type a name and press Add. Notes are optional.',
        action: { label: 'Open the Rolodex', place: { view: 'rolodex' }, targets: [t('rolodex-add'), PAGE_TITLE] },
        detect: (f) => f.comics.length > 0,
      },
      {
        id: 'profile',
        title: 'Fill in their profile',
        text: 'Open a person to add a headshot, socials, an email and walk-on music.',
        action: { label: 'Open the Rolodex', place: { view: 'rolodex' }, targets: [PAGE_TITLE] },
        detect: (f) => f.comics.some((c) => !!(c.email || c.socialMedia || c.photo || c.walkOnMusic)),
      },
      {
        id: 'ask',
        title: 'Ask them for their own details',
        text: 'Send a link and they fill in their profile themselves. You approve what comes back.',
        online: true,
        action: { label: 'Open the Rolodex', place: { view: 'rolodex' }, targets: [PAGE_TITLE] },
        detect: (f) => (f.settings.profileRequests ?? []).length > 0,
      },
      {
        id: 'term',
        title: 'Change what you call them',
        text: 'Comics, queens, acts: set the word in Settings.',
        action: { label: 'Open Settings', ...settingsCard('settings-workspace') },
        detect: (f) => !!f.settings.rolodexTermSingular?.trim(),
      },
    ],
  },
  {
    id: 'contracts',
    title: 'Contracts and signing',
    short: 'Contracts',
    description: 'Send an agreement and get it back signed.',
    steps: [
      {
        id: 'add',
        title: 'Add a PDF',
        text: 'Upload the agreement you already use.',
        locked: 'contracts',
        online: true,
        action: { label: 'Open Contracts', place: { view: 'contracts' }, targets: [t('contracts-add'), t('producer-lock'), PAGE_TITLE] },
        detect: (f) => f.settings.contracts.length > 0,
      },
      {
        id: 'send',
        title: 'Mark where to sign and send it',
        text: 'Place the signature and any fields, then choose who it goes to from your Rolodex. You get a link to send them; the app does not email it for you.',
        locked: 'contracts',
        online: true,
        action: { label: 'Open Contracts', place: { view: 'contracts' }, targets: [t('contracts-add'), t('producer-lock'), PAGE_TITLE] },
        detect: (f) => f.settings.signatureRequests.length > 0,
      },
      {
        id: 'signed',
        title: 'Get it back',
        text: 'They sign on their phone. The signed copy is filed here and the count on More goes down.',
        online: true,
        action: { label: 'Open Contracts', place: { view: 'contracts' }, targets: [PAGE_TITLE] },
        detect: (f) => signatureSummary(f.settings.signatureRequests).signed > 0,
      },
      {
        id: 'file',
        title: 'File an agreement signed elsewhere',
        text: 'Keep venue and producer agreements you already have with the rest. You can do this on any plan.',
        action: { label: 'Open Contracts', place: { view: 'contracts' }, targets: [PAGE_TITLE] },
        detect: (f) => (f.settings.signedAgreements ?? []).length > 0,
      },
    ],
  },
  {
    id: 'live',
    title: 'Viewer link and Run Show',
    short: 'Live',
    description: 'The public page and the live board.',
    steps: [
      {
        id: 'viewer',
        title: 'Make a viewer link',
        text: 'On a show, open the menu at the top right and choose Viewer link. It makes a public page that follows the night. Add a note for before the show if you like.',
        locked: 'viewer',
        online: true,
        action: { label: 'Open a show', place: REAL, targets: [t('show-more')] },
        detect: (f) => f.realShows.some((show) => !!show.viewToken),
      },
      {
        id: 'board',
        title: 'Try the live board',
        text: 'Press the Run Show button at the top of a show. Start the clock and step through the cues.',
        action: { label: 'Open a show', place: REAL, targets: [t('show-run')] },
        detect: (f) => f.ranShow,
      },
      {
        id: 'remote',
        title: 'Pair a stage remote',
        text: 'Teach the app which key your clicker sends, so it can start and stop the music.',
        locked: 'remote',
        action: { label: 'Open Settings', ...settingsCard('settings-remote') },
        detect: (f) => !!f.settings.remoteMusicKey,
      },
      {
        id: 'night',
        title: 'On the night',
        text: 'Use Fullscreen so nothing steals the clicker, and keep this device plugged in.',
      },
    ],
  },
  {
    id: 'music',
    title: 'Music and walk-ons',
    short: 'Music',
    description: 'Tracks for the room and for each act.',
    steps: [
      {
        id: 'upload',
        title: 'Upload your tracks',
        text: 'Walk-on beds, intermission music, play-off stings. Upload once; they appear in every show.',
        action: { label: 'Open Music', place: { view: 'music' }, targets: [t('music-upload'), PAGE_TITLE] },
        detect: (f) => f.settings.musicLibrary.length > 0,
      },
      {
        id: 'trim',
        title: 'Trim a track',
        text: 'Set where a track starts and ends so it comes in on the right bar.',
        action: { label: 'Open Music', place: { view: 'music' }, targets: [PAGE_TITLE] },
      },
      {
        id: 'walk-on',
        title: 'Give someone a walk-on',
        text: 'Open a person in the Rolodex, or a performer on a show, and upload their walk-on.',
        action: { label: 'Open the Rolodex', place: { view: 'rolodex' }, targets: [PAGE_TITLE] },
        detect: (f) => f.comics.some((c) => !!c.walkOnMusic)
          || f.realShows.some((show) => show.performers.some((p) => !!p.walkOnMusic)),
      },
      {
        id: 'dj',
        title: 'Add DJ Music to a show',
        text: 'Turn on the DJ Music section for a show to plan the songs for that night.',
        action: { label: 'Open a show', place: REAL, targets: [t('show-sections'), t('show-more')] },
        detect: (f) => f.realShows.some((show) => !(show.hiddenSections ?? []).includes('dj')),
      },
    ],
  },
  {
    id: 'promo',
    title: 'Flyer and Post copy',
    short: 'Flyer and post',
    description: 'What you need to announce a show.',
    steps: [
      {
        id: 'flyer',
        title: 'Upload the flyer',
        text: 'Keep the flyer with the show so it is always to hand.',
        action: { label: 'Open a show', place: REAL, targets: [t('show-flyer')] },
        detect: (f) => f.realShows.some((show) => !!show.flyer),
      },
      {
        id: 'post',
        title: 'Copy the lineup for a post',
        text: 'Post copy writes the lineup with everyone’s handles. It appears once someone is on the bill, so on an empty show add someone to the lineup first.',
        action: { label: 'Open a show', place: LINEUP, targets: LINEUP_TOOLS },
      },
      {
        id: 'headshots',
        title: 'Download headshots',
        text: 'Get everyone’s headshots, named after each performer. Surprise guests are left out unless you include them. The download appears once someone on the bill has a headshot, so on an empty show add someone to the lineup first.',
        action: { label: 'Open a show', place: LINEUP, targets: LINEUP_TOOLS },
      },
    ],
  },
  {
    id: 'assistants',
    title: 'Claude and ChatGPT',
    short: 'Assistants',
    description: 'Work on your shows from an AI assistant. Optional.',
    ownerOnly: true,
    steps: [
      {
        id: 'address',
        title: 'Copy your connector address',
        text: 'Settings has an AI assistants card. Open Connect Claude or ChatGPT and copy the connector URL.',
        action: { label: 'Open Settings', ...settingsCard('settings-ai') },
      },
      {
        id: 'add',
        title: 'Add it in Claude or ChatGPT',
        text: 'The card lists the exact steps for each. You add the address as a custom connector there.',
        nativeText: 'Claude and ChatGPT open in Safari.',
        online: true,
        action: { label: 'Open Settings', ...settingsCard('settings-ai') },
      },
      {
        id: 'allow',
        title: 'Choose what it may do',
        text: 'The assistant sends you back here to sign in and pick what it is allowed to read and change. Nothing is shared before that.',
        online: true,
        detect: (f) => (f.assistantConnections ?? 0) > 0,
      },
      {
        id: 'check',
        title: 'Check or remove connections',
        text: 'See which assistants are connected. You can disconnect any of them from the AI assistants card in Settings.',
        online: true,
        action: { label: 'Check connections', check: 'connections' },
        detect: (f) => f.assistantConnections !== null,
      },
    ],
  },
  {
    id: 'coproducers',
    title: 'Co-producers',
    short: 'Co-producers',
    description: 'Let someone suggest changes that you approve.',
    ownerOnly: true,
    steps: [
      {
        id: 'what',
        title: 'Know what it shares',
        text: 'A co-producer sees your shows and Rolodex through a private link and can propose changes. Nothing changes until you approve it.',
      },
      {
        id: 'link',
        title: 'Make a link',
        text: 'In Settings, type their name, tick that you understand what it shares, and press Make link.',
        online: true,
        action: { label: 'Open Settings', ...settingsCard('settings-coproducers') },
        detect: (f) => f.links > 0,
      },
      {
        id: 'send',
        title: 'Send it to them',
        text: 'The link is shown once. Copy it and send it only to them. If it is lost, make a new one.',
        action: { label: 'Open Settings', ...settingsCard('settings-coproducers') },
      },
      {
        id: 'review',
        title: 'Review what they ask for',
        text: 'Requests appear under More. Approve or decline each one.',
        online: true,
        action: { label: 'Open More', place: { view: 'more' }, targets: [t('more-requests'), PAGE_TITLE] },
      },
    ],
  },
  {
    id: 'backup',
    title: 'Backups and recovery',
    short: 'Backups',
    description: 'Your own copy, and how to get things back.',
    ownerOnly: true,
    steps: [
      {
        id: 'download',
        title: 'Download a backup',
        text: 'A file with all your shows and settings, to keep somewhere of your own.',
        action: { label: 'Open Your data', ...settingsCard('settings-data') },
        detect: (f) => f.lastBackupAt !== null,
      },
      {
        id: 'restore',
        title: 'Restore a deleted show',
        text: 'Deleted shows wait in Recently deleted.',
        action: { label: 'Open Your data', ...settingsCard('settings-data') },
      },
      {
        id: 'versions',
        title: 'Go back to an earlier version',
        text: 'Earlier versions keeps recent copies of your account you can return to.',
        action: { label: 'Open Your data', ...settingsCard('settings-data') },
      },
    ],
  },
  {
    id: 'workspace',
    title: 'Make it yours',
    short: 'Workspace',
    description: 'Your name on it, your words in it.',
    ownerOnly: true,
    steps: [
      {
        id: 'brand',
        title: 'Brand name and show types',
        text: 'Used on exports and to tune the wording.',
        action: { label: 'Open Settings', ...settingsCard('settings-workspace') },
        detect: (f) => f.settings.brandName !== DEFAULT_SETTINGS.brandName && f.settings.showTypes.length > 0,
      },
      {
        id: 'theme',
        title: 'Light or dark',
        text: 'Pick a colour scheme for this device.',
        action: { label: 'Open Settings', ...settingsCard('settings-appearance') },
      },
      {
        id: 'house',
        title: 'Producers, budget and house rules',
        text: 'Who runs the shows with you, what you plan to spend, and rules you send to performers.',
        action: { label: 'Open Settings', ...settingsCard('settings-workspace') },
        detect: (f) => f.settings.producers.length > 0 || f.settings.brandBudget > 0 || f.settings.rules.trim() !== '',
      },
    ],
  },
  {
    id: 'money',
    title: 'Money and the season',
    short: 'Money',
    description: 'What the shows cost and what they add up to.',
    steps: [
      {
        id: 'expense',
        title: 'Record an expense',
        text: 'Track what the shows cost you across the account.',
        action: { label: 'Open Expenses', place: { view: 'expenses' }, targets: [PAGE_TITLE] },
        detect: (f) => f.settings.expenses.length > 0,
      },
      {
        id: 'emails',
        title: 'Keep your email list',
        text: 'Add the addresses you collect at shows. The app stores them; it does not send email.',
        action: { label: 'Open Email list', place: { view: 'emails' }, targets: [PAGE_TITLE] },
        detect: (f) => f.settings.emailList.length > 0,
      },
      {
        id: 'recap',
        title: 'Fill in a recap',
        text: 'After a show, its Recap section takes the door count and the money.',
        action: { label: 'Open a show', place: REAL, targets: ['#show-section-header-recap', t('show-hero')] },
      },
      {
        id: 'season',
        title: 'Read the Season report',
        text: 'Every show added up, with a venue pitch ready to paste.',
        locked: 'season',
        action: { label: 'Open Season report', place: { view: 'season' }, targets: [PAGE_TITLE, t('producer-lock')] },
      },
    ],
  },
];

export function wizardById(id: WizardId | undefined): Wizard | undefined {
  return WIZARDS.find((wizard) => wizard.id === id);
}

export function wizardStep(id: WizardId | undefined, stepId: string | undefined): WizardStep | undefined {
  return wizardById(id)?.steps.find((step) => step.id === stepId);
}

/** The wizards this view shows. Co-producer view leaves out the ones about the owner's own account. */
export function wizardsFor(reviewing: boolean): Wizard[] {
  return WIZARDS.filter((wizard) => !reviewing || !wizard.ownerOnly);
}

/** What the detectors read, from the account as it stands. */
export function wizardFacts(input: {
  shows: readonly Show[];
  settings: AppSettings;
  links: number;
  lastBackupAt: string | null;
  ranShow: boolean;
  assistantConnections: number | null;
}): WizardFacts {
  return {
    realShows: input.shows.filter((show) => !show.sample),
    comics: ownComics(input.settings.potentialComics, [...input.shows, ...trashedSamples(input.settings)]),
    settings: input.settings,
    links: input.links,
    lastBackupAt: input.lastBackupAt,
    ranShow: input.ranShow,
    assistantConnections: input.assistantConnections,
  };
}

/**
 * Sample shows deleted to the trash. Deleting the sample does not make the
 * people the tour put on its bill the producer's own, so ownComics still
 * reads their bill. A deleted show of the producer's own is not included: it
 * never hides anyone.
 */
function trashedSamples(settings: AppSettings): Show[] {
  return (settings.trash ?? []).filter((item) => item.type === 'show' && item.data?.sample).map((item) => item.data);
}

/** Whether this show is one of the producer's own: never a sample, old or new. */
export function isOwnShow(shows: readonly Show[], id: string | null): boolean {
  return id !== null && shows.some((show) => show.id === id && !show.sample);
}

/** The Rolodex entries and names a set of shows' bills point at. */
function billed(shows: readonly Show[]): { ids: Set<string>; names: Set<string> } {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const show of shows) {
    for (const person of [...show.performers, ...(show.artists ?? [])]) {
      if (person.comicId) ids.add(person.comicId);
      if (person.name) names.add(rolodexKey(person.name));
    }
  }
  return { ids, names };
}

/**
 * The Rolodex without anyone who is there only because of a sample show.
 *
 * Anyone put on a bill is filed in the Rolodex, the sample's included. Such a
 * person counts once they are on a show of the producer's own too. Someone
 * the producer filed by hand and then also tried out on the sample is left
 * out until then: the Rolodex keeps no note of how each person got there.
 */
export function ownComics(comics: readonly PotentialComic[], shows: readonly Show[]): PotentialComic[] {
  const samples = shows.filter((show) => show.sample);
  if (samples.length === 0) return [...comics];
  const onSample = billed(samples);
  const onOwn = billed(shows.filter((show) => !show.sample));
  const on = (bill: { ids: Set<string>; names: Set<string> }, comic: PotentialComic) => bill.ids.has(comic.id) || bill.names.has(rolodexKey(comic.name));
  return comics.filter((comic) => !on(onSample, comic) || on(onOwn, comic));
}

/** Whether a step has nothing to read and is ticked by hand instead. */
export function stepIsManual(wizard: WizardId, stepId: string): boolean {
  const step = wizardStep(wizard, stepId);
  return !!step && !step.detect;
}

/**
 * Whether a step is done. Null means there is nothing to detect and it has
 * not been ticked: the step shows its tick box.
 */
export function stepDone(wizard: WizardId, stepId: string, facts: WizardFacts, checked: readonly string[]): boolean | null {
  const step = wizardStep(wizard, stepId);
  if (!step) return null;
  if (step.detect) return step.detect(facts);
  return checked.includes(stepId) ? true : null;
}

/**
 * How far along a wizard is. A step the free plan holds back is left out of
 * both numbers, so a wizard can still read "Done" on the plan it is used on.
 */
export function wizardProgress(wizard: Wizard, facts: WizardFacts, checked: readonly string[], locked: boolean): { done: number; total: number } {
  const steps = wizard.steps.filter((step) => !(locked && step.locked));
  return {
    done: steps.filter((step) => stepDone(wizard.id, step.id, facts, checked) === true).length,
    total: steps.length,
  };
}

/** The words on a wizard's chip. */
export function progressLabel(progress: { done: number; total: number }): string {
  if (progress.total > 0 && progress.done >= progress.total) return 'Done';
  if (progress.done === 0) return 'Not started';
  return `${progress.done} of ${progress.total}`;
}
