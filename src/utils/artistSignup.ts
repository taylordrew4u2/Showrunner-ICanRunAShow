import { api } from './api';

export interface ArtistSignupPayload {
  showName: string;
  venueName?: string;
  scheduleVisible: boolean;
  schedule?: Array<{ time?: string; description: string; performer?: string }>;
  flashImage?: string;
  scheduleImage?: string;
  startsAtIso?: string; // ISO datetime for the public "starts at" countdown
  paymentLinks?: { cashApp?: string; venmo?: string; zelle?: string; other?: string };
  liveToken?: string; // so the page can also pull live on-stage/up-next from live_view
  welcomeMessage?: string;
  pricingLabels?: { black?: string; color?: string };
  sections?: {
    schedule?: boolean;
    flash?: boolean;
    live?: boolean;
    signups?: boolean;
    payment?: boolean;
  };
  lastUpdateMs: number;
}

export interface ArtistSignupEntry {
  id: string;
  name: string;
  phone?: string; // present for admin queries; the public list strips it client-side
  email?: string; // present for admin queries; the public list strips it client-side
  imageNumber?: number;
  color?: 'black' | 'color';
  completed: boolean;
  createdAt: string;
}

export async function publishArtistPayload(token: string, payload: ArtistSignupPayload): Promise<void> {
  await api.post('/api/artist', { token, payload });
}

export async function fetchArtistPayload(token: string): Promise<ArtistSignupPayload | null> {
  const { payload } = await api.get<{ payload: ArtistSignupPayload | null }>(
    `/api/artist?token=${encodeURIComponent(token)}`,
  );
  return payload;
}

export async function listSignups(token: string): Promise<ArtistSignupEntry[]> {
  const { entries } = await api.get<{ entries: ArtistSignupEntry[] }>(
    `/api/artist-entries?token=${encodeURIComponent(token)}`,
  );
  return entries;
}

export async function createSignup(
  token: string,
  entry: { id: string; name: string; phone?: string; email?: string; imageNumber?: number; color?: 'black' | 'color' },
): Promise<void> {
  await api.post('/api/artist-entries', { token, entry });
}

export async function setSignupCompleted(id: string, completed: boolean): Promise<void> {
  await api.patch('/api/artist-entries', { id, completed });
}

export async function deleteSignup(id: string): Promise<void> {
  await api.del(`/api/artist-entries?id=${encodeURIComponent(id)}`);
}
