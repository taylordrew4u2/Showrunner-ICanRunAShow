/**
 * The guided tour, as data.
 *
 * Each step names a place in the app, the real control it is about (by its
 * data-tour id, with fallbacks) and what to say. The tour only ever takes
 * the producer somewhere and points: no step presses anything that sends,
 * publishes, makes a link, uploads or downloads.
 *
 * The text names every control and where it is, so the outline is never the
 * only cue. No step states a price; ProducerLock owns that.
 */
import type { GuidePlace } from './places';

/** The features the free plan holds back. */
export type LockedFeature = 'contracts' | 'import' | 'viewer' | 'season' | 'remote';

/** What ProducerLock is told each feature is called: the same words the app's own locks use. */
export const LOCKED_FEATURE_LABELS: Record<LockedFeature, string> = {
  contracts: 'Sending contracts for signature',
  import: 'Reading a schedule from a photo or PDF',
  viewer: 'A live link for your audience',
  season: 'The Season report',
  remote: 'Pairing a stage remote',
};

export interface TourStep {
  /** Stored, so a step added later does not move anyone who stopped part-way. */
  id: string;
  /** 'runshow' steps exist only while the live board is open. */
  surface: 'app' | 'runshow';
  place?: GuidePlace;
  /** Selectors, in order of preference. The first one on screen is outlined. */
  targets: string[];
  title: string;
  body: string | { phone: string; desktop: string };
  /** Said instead of `body` on the free plan, beside the app's own lock note. */
  locked?: { feature: LockedFeature; body: string };
}

const t = (id: string) => `[data-tour="${id}"]`;
const SAMPLE: GuidePlace = { view: 'detail', show: 'sample' };

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    surface: 'app',
    place: SAMPLE,
    targets: [t('show-hero')],
    title: 'This is a show',
    body: 'Everything for one night lives on a page like this. This one is a sample, so try anything. Use Next step to move on, or End tour to stop. You can pick it up again from More, then Help & setup.',
  },
  {
    id: 'shows',
    surface: 'app',
    place: { view: 'list' },
    targets: [t('show-card-sample'), t('shows-dash'), t('page-title')],
    title: 'Your shows',
    body: 'Shows is your desk. The next show sits at the top with what it still needs. Upcoming and History split what is ahead from what is done, and you can search, sort or switch to a calendar.',
  },
  {
    id: 'new-show',
    surface: 'app',
    place: { view: 'list' },
    targets: [t('shows-new')],
    title: 'Start a show',
    body: 'The New Show button at the top of this page starts a new show: a name and a date are enough. The tour will not create one.',
  },
  {
    id: 'nav',
    surface: 'app',
    place: { view: 'list' },
    targets: [t('nav-rolodex'), t('nav-toggle')],
    title: 'Getting around',
    body: {
      phone: 'The bar along the bottom goes everywhere: Shows, Rolodex, Music, More and Settings.',
      desktop: 'The menu button at the top left opens the five places in the app: Shows, Rolodex, Music, More and Settings.',
    },
  },
  {
    id: 'sync',
    surface: 'app',
    place: { view: 'list' },
    targets: [t('sync-status'), t('nav-toggle')],
    title: 'Saved as you work',
    body: 'There is no Save button on a show. The pill at the top of the screen says when your work last reached your account, and tells you if you are offline. Work done offline is kept on this device and sent when you are back.',
  },
  {
    id: 'hero',
    surface: 'app',
    place: SAMPLE,
    targets: [t('show-hero')],
    title: 'Name, date, status',
    body: 'Tap the name at the top of the show to rename it. Status moves it from upcoming to completed or cancelled, and the date, time and venue sit underneath.',
  },
  {
    id: 'lineup',
    surface: 'app',
    place: { view: 'detail', show: 'sample', section: 'performers' },
    targets: [t('lineup-add'), '#show-section-header-performers'],
    title: 'The lineup',
    body: 'Add everyone on the bill in the lineup section. Each performer gets a profile with a headshot, socials, email, credits and walk-on music. Anyone you add is also filed in your Rolodex, on a real show and on this sample alike.',
  },
  {
    id: 'host',
    surface: 'app',
    place: SAMPLE,
    targets: [t('show-host')],
    title: 'Hosts',
    body: 'Under the show details, type a host, or pick one from the lineup or your Rolodex. A show can have two.',
  },
  {
    id: 'schedule',
    surface: 'app',
    place: { view: 'detail', show: 'sample', section: 'schedule' },
    targets: [t('schedule-tools'), '#show-section-header-schedule'],
    title: 'The running order',
    body: 'Each line of the schedule is a cue with a time and a length. Generate times fills them in from your lineup, a template reuses a night you have built before, and Import reads a schedule from a photo or PDF.',
    locked: {
      feature: 'import',
      body: 'Each line of the schedule is a cue with a time and a length. Generate times fills them in from your lineup, and a template reuses a night you have built before. Reading a schedule from a photo or PDF is part of the Producer plan.',
    },
  },
  {
    id: 'notes',
    surface: 'app',
    place: SAMPLE,
    targets: [t('show-notes')],
    title: 'Production notes',
    body: 'The notes box holds reminders for the night: soundcheck, door time, who has the cash box. Saved with the show.',
  },
  {
    id: 'sections',
    surface: 'app',
    place: SAMPLE,
    targets: [t('show-sections'), t('show-more')],
    title: 'More sections',
    body: 'A show starts with a lineup and a running order. Add or remove sections brings in Artists, DJ Music, Staff, Vendors or Scenes when a night needs them, and takes them away when it does not. After the show date a Recap section appears for the door count and the money.',
  },
  {
    id: 'flyer',
    surface: 'app',
    place: SAMPLE,
    targets: [t('show-flyer')],
    title: 'Flyer',
    body: 'The Flyer box keeps the show’s flyer with the show. Upload it once, then view or download it from here.',
  },
  {
    id: 'promo',
    surface: 'app',
    place: { view: 'detail', show: 'sample', section: 'performers' },
    targets: [t('lineup-actions'), '#show-section-header-performers'],
    title: 'Post copy and headshots',
    body: 'Once a show has performers, Post copy in the lineup section writes the lineup with everyone’s handles, ready to paste. You can also email the whole bill and download their headshots, named.',
  },
  {
    id: 'run-open',
    surface: 'app',
    place: SAMPLE,
    targets: [t('show-run')],
    title: 'Run the night',
    body: 'This is the part to try. Press the Run Show button at the top of the show to open the live board. Nothing is published and nobody is notified. Or use Next step to skip it.',
  },
  {
    id: 'run-clock',
    surface: 'runshow',
    targets: [t('run-clock')],
    title: 'The clock',
    body: 'Press Start, or the space bar. The clock counts the current set down and says when you are running long. The arrow keys, or the buttons, move to the next cue.',
  },
  {
    id: 'run-board',
    surface: 'runshow',
    targets: [t('run-board')],
    title: 'The soundboard',
    body: 'Every track in your Music library and every walk-on gets a button on the soundboard. S plays and stops the music. Fullscreen keeps a clicker pointed at this screen.',
  },
  {
    id: 'run-close',
    surface: 'runshow',
    targets: [t('run-close')],
    title: 'Leaving the board',
    body: 'Close the board with the X at the top right, or Escape, and the tour carries on. On a real night, Finish show marks the show completed.',
  },
  {
    id: 'viewer',
    surface: 'app',
    place: SAMPLE,
    targets: [t('show-more')],
    title: 'Viewer link',
    body: 'In the menu at the top right of the show, Viewer link makes a public page your audience or the room’s screen can follow, with a note for before the show. It goes live only when you choose to make the link. The tour does not make one.',
    locked: {
      feature: 'viewer',
      body: 'In the menu at the top right of the show, Viewer link makes a public page your audience or the room’s screen can follow, with a note for before the show. New viewer links are part of the Producer plan. The tour does not make one.',
    },
  },
  {
    id: 'show-menu',
    surface: 'app',
    place: SAMPLE,
    targets: [t('show-more')],
    title: 'Export, duplicate, repeat',
    body: 'The same menu exports a run sheet as a PDF, duplicates the show, repeats it on other dates, and deletes it. Deleted shows wait in Recently deleted.',
  },
  {
    id: 'rolodex',
    surface: 'app',
    place: { view: 'rolodex' },
    targets: [t('rolodex-add'), t('page-title')],
    title: 'The Rolodex',
    body: 'Everyone you might book. Save a person once with the form at the top and reuse them on any show; edit them here and every show updates. You can also send someone a link to fill in their own details.',
  },
  {
    id: 'music',
    surface: 'app',
    place: { view: 'music' },
    targets: [t('music-upload'), t('page-title')],
    title: 'Music',
    body: 'Upload a track once with the Upload track button and it is in every show’s DJ list and on every soundboard. You can trim a track to the part you want.',
  },
  {
    id: 'more',
    surface: 'app',
    place: { view: 'more' },
    targets: [t('more-season'), t('page-title')],
    title: 'More',
    body: 'The paperwork between shows lives on the More page: the Season report, contracts, your email list and expenses.',
  },
  {
    id: 'contracts',
    surface: 'app',
    place: { view: 'contracts' },
    targets: [t('contracts-add'), t('producer-lock'), t('page-title')],
    title: 'Contracts',
    body: 'Add a PDF with Add for signature at the top, mark where to sign, and send it to someone in your Rolodex. They sign on their phone and the signed copy is filed here. Agreements signed elsewhere can be filed too.',
    locked: {
      feature: 'contracts',
      body: 'Add a PDF, mark where to sign, and send it to someone in your Rolodex. They sign on their phone and the signed copy is filed here. Sending contracts for signature is part of the Producer plan. Filing agreements you already have is not.',
    },
  },
  {
    id: 'season',
    surface: 'app',
    place: { view: 'season' },
    targets: [t('page-title'), t('producer-lock')],
    title: 'Season report',
    body: 'Every show added up: audience, money, your regulars and rooms, and a venue pitch ready to paste. The sample show is never counted.',
    locked: {
      feature: 'season',
      body: 'The Season report adds up every show: audience, money, your regulars and rooms. It is part of the Producer plan.',
    },
  },
  {
    id: 'money',
    surface: 'app',
    place: { view: 'expenses' },
    targets: [t('page-title')],
    title: 'Expenses and the email list',
    body: 'Expenses tracks what the shows cost you across the account. Email list, next to it under More, keeps the addresses you collect at shows. The app stores them; it does not send email for you.',
  },
  {
    id: 'settings',
    surface: 'app',
    place: { view: 'settings', anchor: 'settings-workspace' },
    targets: [t('settings-workspace')],
    title: 'Settings',
    body: 'Your workspace holds your brand name, the kinds of shows you make, and what you call the people in your Rolodex. Settings has a Save button; nothing here saves until you press it.',
  },
  {
    id: 'data',
    surface: 'app',
    place: { view: 'settings', anchor: 'settings-data' },
    targets: [t('settings-data')],
    title: 'Your data',
    body: 'In the Your data card, download a backup file, restore a show from Recently deleted, or go back to an Earlier version. Your work is encrypted before it leaves this device.',
  },
  {
    id: 'connect',
    surface: 'app',
    place: { view: 'settings', anchor: 'settings-ai' },
    targets: [t('settings-ai'), t('settings-coproducers'), t('settings-data')],
    title: 'Assistants and co-producers',
    body: 'Two optional ways to get help, each with a card in Settings: connect Claude or ChatGPT to work on your shows, and give a co-producer a link so they can suggest changes for you to approve. Both start only when you set them up.',
  },
  {
    id: 'end',
    surface: 'app',
    place: { view: 'help' },
    targets: [t('help-wizards')],
    title: 'That is the tour',
    body: 'Help & setup has a short step-by-step for each of these, for when you want one. The sample show stays in your Shows until you delete it.',
  },
];

export const FIRST_STEP_ID = TOUR_STEPS[0].id;
export const LAST_STEP_ID = TOUR_STEPS[TOUR_STEPS.length - 1].id;
