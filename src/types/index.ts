export type ShowStatus = 'upcoming' | 'in-progress' | 'completed' | 'cancelled';
export type SceneStatus = 'planned' | 'rehearsed' | 'filmed' | 'done';

export interface Scene {
  id: string;
  title: string;
  description: string;
  duration: number; // minutes
  status: SceneStatus;
  order: number;
}

export interface Show {
  id: string;
  title: string;
  date: string;
  venue: string;
  status: ShowStatus;
  notes: string;
  scenes: Scene[];
  createdAt: string;
}
