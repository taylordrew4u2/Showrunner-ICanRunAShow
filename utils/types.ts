// ─── Core Entity Types ───────────────────────────────────────────────────────

export interface Performer {
  id: string;
  name: string;
  walkOnMusic?: string; // file URI
  photo?: string;       // file URI
  video?: string;       // file URI
}

export interface Artist {
  id: string;
  name: string;
  photo?: string;
  walkOnMusic?: string;
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

export interface Show {
  id: string;
  name: string;
  date: string;
  // Section 1: Basic Show Info
  time: string;
  location: string;
  venueName: string;
  // Section 2: Performers
  performers: Performer[];
  // Section 3: Artists
  artists: Artist[];
  // Section 4: Schedule & Timing
  schedule: ScheduleItem[];
  // Section 5: Hosts
  hosts: Host[];
  // Section 6: DJ Music List
  djSongs: DJSong[];
  // Section 7: Staff & Crew
  staff: StaffMember[];
  // Section 8: Expenses
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
  brandName: 'Pins & Needles',
  producerNames: '',
  rules: '',
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const STAFF_ROLES: string[] = [
  'Videographer',
  'Photographer',
  'Sound',
  'Lighting',
  'Security',
  'Ticket Sales',
  'Stage Manager',
  'MC',
  'Door Person',
  'Other',
];

export const EXPENSE_CATEGORIES: string[] = [
  'Venue',
  'Equipment',
  'Marketing',
  'Talent',
  'Staff',
  'Catering',
  'Travel',
  'Printing',
  'Decorations',
  'Other',
];
