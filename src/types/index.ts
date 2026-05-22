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
  socialMedia?: string;
  walkOnMusic?: string; // file URI
  walkOnMusicName?: string;
  walkOnMusicArtist?: string;
  walkOnMusicTimestamp?: string;
  walkOnMusicLink?: string; // YouTube or Spotify URL
  credits?: string;
  lockedIn?: boolean;
  photo?: string; // file URI
  video?: string; // file URI
}

export interface Artist {
  id: string;
  name: string;
  artistType?: string;
  photo?: string;
  walkOnMusic?: string;
  walkOnMusicName?: string;
  video?: string;
  file?: string; // generic file URI
  fileName?: string;
}

export interface ShowFile {
  id: string;
  name: string;
  fileData: string; // base64 data
  fileType: string; // mime type
  uploadedAt: string;
  notes?: string;
}

export interface ScheduleItem {
  id: string;
  time: string;
  description: string;
}

export interface Host {
  id: string;
  name: string;
  photo?: string;
  notes?: string;
  isHosting: boolean;
}

export interface DJSong {
  id: string;
  title: string;
  artist: string;
  notes?: string;
}

export interface StaffMember {
  id: string;
  role: string;
  personName: string;
}

export interface Expense {
  id: string;
  category: string;
  itemName: string;
  cost: number;
  date?: string;
  notes?: string;
  receiptPhoto?: string; // base64 data URL
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
  photo?: string;
  socialMedia?: string;
  credits?: string;
  walkOnMusic?: string;
  walkOnMusicName?: string;
  walkOnMusicArtist?: string;
  walkOnMusicTimestamp?: string;
  walkOnMusicLink?: string;
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
  | "expenses"
  | "files"
  | "recap";

export interface SectionDeadlines {
  basic?: string; // ISO date string
  performers?: string;
  artists?: string;
  schedule?: string;
  hosts?: string;
  dj?: string;
  staff?: string;
  expenses?: string;
  files?: string;
  recap?: string;
}

export interface SectionCompletions {
  basic?: boolean;
  performers?: boolean;
  artists?: boolean;
  schedule?: boolean;
  hosts?: boolean;
  dj?: boolean;
  staff?: boolean;
  expenses?: boolean;
  files?: boolean;
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
  flyer?: string; // base64 image data
  ticketLink?: string;
  performers: Performer[];
  artists: Artist[];
  schedule: ScheduleItem[];
  scheduleImage?: string; // base64 fallback image when AI can't extract
  hosts: Host[];
  djSongs: DJSong[];
  staff: StaffMember[];
  expenses: Expense[];
  files: ShowFile[];
  scenes?: Scene[];
  recap?: ShowRecap;
  deadlines?: SectionDeadlines;
  completions?: SectionCompletions;
  hiddenSections?: SectionKey[];
  videoPerson?: string; // Name of video person
  videoPayment?: number; // Amount to pay video person
  selectedHostId?: string; // ID of the selected host
  todos?: TodoItem[];
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
};

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
