export type ShowStatus = "upcoming" | "in-progress" | "completed" | "cancelled";
export type SceneStatus = "planned" | "rehearsed" | "filmed" | "done";

export interface Scene {
  id: string;
  title: string;
  description: string;
  duration: number; // minutes
  status: SceneStatus;
  order: number;
}

export interface Performer {
  id: string;
  name: string;
  photo?: string; // headshot (media store reference) — the face on the Run Show button
  socialMedia?: string;
  email?: string; // contact email — used for booking confirmations / mass messages
  walkOnMusic?: string; // file URI
  walkOnMusicName?: string;
  walkOnMusicArtist?: string;
  walkOnMusicTimestamp?: string;
  walkOnMusicLink?: string; // YouTube or Spotify URL
  credits?: string;
  videoLink?: string; // hosted video URL (YouTube, Vimeo, Drive, etc.)
}

export interface Artist {
  id: string;
  name: string;
  artistType?: string;
  socialMedia?: string;
  credits?: string;
  walkOnMusic?: string;
  walkOnMusicName?: string;
  videoLink?: string; // hosted video URL (YouTube, Vimeo, Drive, etc.)
}

export interface ScheduleItem {
  id: string;
  time: string;
  description: string; // the segment / what happens
  performer?: string; // who's on stage (free-text name, e.g. from import)
  durationMin?: number; // how long this segment runs (minutes) — used by Run Show
  performerId?: string; // optional link to a performer record (for walk-on music)
  music?: string; // uploaded intro/transition music (data URL); overrides walk-on
  musicName?: string;
  musicDuration?: number; // seconds to auto-play when the segment starts; undefined = full track
}

/**
 * One cue inside a saved run-of-show template.
 *
 * Deliberately a subset of ScheduleItem: no `id` (regenerated per show, so the
 * same template can be used twice without colliding), no `performerId` (those
 * ids belong to one show's cast), and no `music`/`musicName` — audio would put
 * an unbounded blob inside the settings payload, which has a hard request-size
 * ceiling that, once exceeded, blocks every settings save for the account.
 */
export interface ScheduleTemplateItem {
  time: string;
  description: string;
  performer?: string;
  durationMin?: number;
}

/** A reusable run-of-show, saved once and applied to any future show. */
export interface ScheduleTemplate {
  id: string;
  name: string;
  items: ScheduleTemplateItem[];
  createdAt: string;
}

export interface Host {
  id: string;
  name: string;
  notes?: string;
  isHosting: boolean;
}

export interface DJSong {
  id: string;
  title: string;
  artist: string;
  notes?: string;
  music?: string; // uploaded audio (media store reference) — gets its own Run Show button
  musicName?: string; // original file name of the upload
  /**
   * Set when this song came from the global music library. The audio is then
   * *shared* with the library rather than owned by this show, so removing the
   * song must not delete the underlying media — other shows are pointing at
   * the same reference.
   */
  libraryId?: string;
}

/**
 * A track in the account-wide music library: uploaded once, then added to any
 * show's DJ list without uploading again. Shows reference the same media, so
 * the audio is stored once no matter how many shows use it.
 */
export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  notes?: string;
  /** Media-store reference. A library track exists to carry audio. */
  music: string;
  musicName?: string;
  addedAt: string;
}

export interface StaffMember {
  id: string;
  role: string;
  personName: string;
  phone?: string;
}

export interface Vendor {
  id: string;
  name: string;
  category?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  website?: string;
  cost?: number;
  notes?: string;
  booked?: boolean;
}

export interface Expense {
  id: string;
  category: string;
  itemName: string;
  cost: number;
  date?: string;
  notes?: string;
}

export interface Producer {
  id: string;
  name: string;
  role: string;
}

export interface PotentialComic {
  id: string;
  name: string;
  notes?: string;
  // Optional performer data saved from a show
  socialMedia?: string;
  email?: string; // contact email

  credits?: string;
  walkOnMusic?: string;
  walkOnMusicName?: string;
  walkOnMusicArtist?: string;
  walkOnMusicTimestamp?: string;
  walkOnMusicLink?: string;
}

export interface EmailListEntry {
  id: string;
  email: string;
  addedAt: string;
}

export interface ShowRecap {
  attendance?: number;
  merchSales?: number;
  performerNotes?: string;
  improvementNotes?: string;
  profitLoss?: number;
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

export type SectionKey =
  | "basic"
  | "performers"
  | "artists"
  | "schedule"
  | "hosts"
  | "dj"
  | "staff"
  | "vendors"
  | "expenses"
  | "recap";

export interface SectionCompletions {
  basic?: boolean;
  performers?: boolean;
  artists?: boolean;
  schedule?: boolean;
  hosts?: boolean;
  dj?: boolean;
  staff?: boolean;
  vendors?: boolean;
  expenses?: boolean;
  recap?: boolean;
}

export interface Show {
  id: string;
  name: string;
  date: string;
  time: string;
  location: string;
  venueName: string;
  status: ShowStatus;
  ticketLink?: string;
  performers: Performer[];
  artists: Artist[];
  schedule: ScheduleItem[];
  hosts: Host[];
  djSongs: DJSong[];
  staff: StaffMember[];
  vendors?: Vendor[];
  expenses: Expense[];
  scenes?: Scene[];
  recap?: ShowRecap;
  completions?: SectionCompletions;
  hiddenSections?: SectionKey[];
  /**
   * How many performers this show is booking for. Optional: with no target the
   * lineup has no "full", and nothing about it is shown.
   */
  performerTarget?: number;
  host?: string; // host name (free text, or set from a performer)
  todos?: TodoItem[];
  viewToken?: string; // public read-only viewer link token
  viewNote?: string; // optional note shown on the viewer page before the show starts
  createdAt: string;
  updatedAt: string;
}

export interface DeletedItem {
  id: string;
  type: 'show';
  data: Show;
  deletedAt: string;
}

export interface AppSettings {
  brandName: string;
  producers: Producer[];
  rules: string;
  brandBudget: number;
  totalSpent: number;
  trash: DeletedItem[];
  potentialComics: PotentialComic[];
  expenses: Expense[];
  emailList: EmailListEntry[]; // collected audience emails — storage only, no sending
  scheduleTemplates: ScheduleTemplate[]; // reusable run-of-show layouts
  musicLibrary: MusicTrack[]; // account-wide DJ tracks, addable to any show
  showTypes: string[]; // kinds of shows this producer makes (set during onboarding)
  onboarded: boolean; // whether the account has completed the welcome onboarding
  rolodexTermSingular?: string; // override for the Rolodex noun, e.g. "Comic" / "Queen"
  rolodexTermPlural?: string; // override for the plural Rolodex noun
}

export const DEFAULT_SETTINGS: AppSettings = {
  brandName: "Show Producer",
  producers: [],
  rules: "",
  brandBudget: 0,
  totalSpent: 0,
  trash: [],
  potentialComics: [],
  expenses: [],
  emailList: [],
  scheduleTemplates: [],
  musicLibrary: [],
  showTypes: [],
  onboarded: false,
};

// The kinds of shows a producer can run. Offered as multi-select chips during
// onboarding and editable later in Settings.
export const SHOW_TYPES: string[] = [
  "Comedy",
  "Open Mic",
  "Improv",
  "Music",
  "Variety",
  "Theater",
  "Burlesque",
  "Drag",
  "Magic",
  "Dance",
  "Podcast / Live Recording",
  "Corporate / Private Event",
  "Other",
];

export const STAFF_ROLES: string[] = [
  "Videographer",
  "Photographer",
  "Sound",
  "Lighting",
  "Security",
  "Ticket Sales",
  "Stage Manager",
  "MC",
  "Door Person",
  "Other",
];

export const VENDOR_CATEGORIES: string[] = [
  "Catering",
  "Bar",
  "Sound",
  "Lighting",
  "Staging",
  "Rentals",
  "Photography",
  "Videography",
  "Security",
  "Decor",
  "Transportation",
  "Printing",
  "Venue",
  "Other",
];

export const EXPENSE_CATEGORIES: string[] = [
  "Venue",
  "Equipment",
  "Marketing",
  "Talent",
  "Staff",
  "Catering",
  "Travel",
  "Printing",
  "Decorations",
  "Apparel",
  "Materials",
  "Other",
];
