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
  walkOnMusicName?: string;
  photo?: string;
}

export interface ScheduleItem {
  id: string;
  time: string;
  description: string;
}

export interface Host {
  id: string;
  name: string;
  isHosting: boolean;
  notes?: string;
  photo?: string;
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
  cost: number | string;
  date?: string;
  notes?: string;
}

export interface Show {
  id: string;
  name: string;
  date?: string;
  time?: string;
  venueName?: string;
  location?: string;
  status?: ShowStatus;
  notes?: string;
  performers: Performer[];
  artists: Performer[];
  schedule: ScheduleItem[];
  hosts: Host[];
  djSongs: DJSong[];
  staff: StaffMember[];
  expenses: Expense[];
  scenes?: Scene[];
  createdAt?: string;
}

export interface AppSettings {
  brandName: string;
  producerNames?: string;
  rules?: string;
}
