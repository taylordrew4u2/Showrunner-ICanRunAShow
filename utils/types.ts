// ─── Core Entity Types ───────────────────────────────────────────────────────

export interface Performer {
  id: string;
  name: string;
  socialMedia?: string;
  walkOnMusic?: string; // file URI
  walkOnMusicName?: string;
  walkOnMusicTimestamp?: string;
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
}

export interface Producer {
  id: string;
  name: string;
  role: string;
}

export interface ShowRecap {
  attendance?: number;
  merchSales?: number;
  performerNotes?: string;
  improvementNotes?: string;
  profitLoss?: number;
}

// ─── Show ─────────────────────────────────────────────────────────────────────

export type ShowStatus = "upcoming" | "in-progress" | "completed" | "cancelled";

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
  // Section 1: Basic Show Info
  time: string;
  location: string;
  venueName: string;
  status: ShowStatus;
  flyer?: string; // base64 image data
  ticketLink?: string;
  // Section 2: Performers
  performers: Performer[];
  // Section 3: Artists
  artists: Artist[];
  // Section 4: Schedule & Timing
  schedule: ScheduleItem[];
  // Section 4: Hosts
  hosts: Host[];
  // Section 5: DJ Music List
  djSongs: DJSong[];
  // Section 6: Staff & Crew
  staff: StaffMember[];
  // Section 7: Expenses
  expenses: Expense[];
  // Section 8: Files
  files: ShowFile[];
  // Post-show recap
  recap?: ShowRecap;
  // Section deadlines
  deadlines?: SectionDeadlines;
  // Section completions
  completions?: SectionCompletions;
  // Hidden sections
  hiddenSections?: SectionKey[];
  // Video and host assignment
  videoPerson?: string; // Name of video person
  videoPayment?: number; // Amount to pay video person
  selectedHostId?: string; // ID of the selected host
  createdAt: string;
  updatedAt: string;
}

// ─── App Settings ─────────────────────────────────────────────────────────────

export interface AppSettings {
  brandName: string;
  producers: Producer[];
  rules: string;
  brandBudget: number;
  totalSpent: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  brandName: "Show Producer",
  producers: [],
  rules: "",
  brandBudget: 0,
  totalSpent: 0,
};

// ─── Constants ────────────────────────────────────────────────────────────────

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
  "Other",
];
