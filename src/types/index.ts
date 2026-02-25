// ─── Core Entity Types ───────────────────────────────────────────────────────

export interface Performer {
  id: string;
  name: string;
  walkOnMusic?: string;
  walkOnMusicName?: string;
  photo?: string;
  video?: string;
}

export interface Artist {
  id: string;
  name: string;
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

// ─── Show ─────────────────────────────────────────────────────────────────────

export type ShowStatus = "upcoming" | "in-progress" | "completed" | "cancelled";

export interface Show {
  id: string;
  name: string;
  date: string;
  time: string;
  location: string;
  venueName: string;
  status: ShowStatus;
  performers: Performer[];
  artists: Artist[];
  schedule: ScheduleItem[];
  hosts: Host[];
  djSongs: DJSong[];
  staff: StaffMember[];
  expenses: Expense[];
  createdAt: string;
  updatedAt: string;
}

// ─── App Settings ─────────────────────────────────────────────────────────────

export interface AppSettings {
  brandName: string;
  producerNames: string;
  rules: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  brandName: "Show Producer",
  producerNames: "",
  rules: "",
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
  "Venue Rental",
  "Equipment",
  "Marketing",
  "Catering",
  "Staff Pay",
  "Performer Pay",
  "Travel",
  "Printing",
  "Decorations",
  "Misc",
];
