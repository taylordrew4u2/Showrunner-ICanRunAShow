// ─── Core Entity Types ───────────────────────────────────────────────────────

export interface Performer {
  id: string;
  name: string;
  socialMedia?: string;
  walkOnMusic?: string; // file URI
  walkOnMusicName?: string;
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
  | "performers"
  | "artists"
  | "schedule"
  | "hosts"
  | "dj"
  | "staff"
  | "expenses";

export interface SectionDeadlines {
  performers?: string; // ISO date string
  artists?: string;
  schedule?: string;
  hosts?: string;
  dj?: string;
  staff?: string;
  expenses?: string;
}

export interface SectionCompletions {
  performers?: boolean;
  artists?: boolean;
  schedule?: boolean;
  hosts?: boolean;
  dj?: boolean;
  staff?: boolean;
  expenses?: boolean;
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
  // Post-show recap
  recap?: ShowRecap;
  // Section deadlines
  deadlines?: SectionDeadlines;
  // Section completions
  completions?: SectionCompletions;
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
