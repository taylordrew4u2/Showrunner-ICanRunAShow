import { describe, it, expect } from 'vitest';
import { stripLegacyShowMedia, stripLegacySettingsMedia } from './stripMedia';
import type { AppSettings, Show } from '../types';
import { DEFAULT_SETTINGS } from '../types';

const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(500);

// A show as an older version of the app may have saved it — carrying photo,
// video, and file blobs that no longer exist on the types.
function legacyShow(): Show {
  const show = {
    id: 's1',
    name: 'Comedy Night',
    date: '2026-08-01',
    time: '8:00 PM',
    location: 'Portland',
    venueName: 'The Basement',
    status: 'upcoming',
    flyer: dataUrl,
    scheduleImage: dataUrl,
    artistFlashImage: dataUrl,
    artistScheduleImage: dataUrl,
    performers: [
      {
        id: 'p1',
        name: 'Alice',
        photo: dataUrl,
        photos: [dataUrl],
        video: dataUrl,
        walkOnMusic: 'media:abc123',
        walkOnMusicName: 'Intro.mp3',
        videoLink: 'https://vimeo.com/123',
      },
    ],
    artists: [
      { id: 'a1', name: 'Bea', photo: dataUrl, video: dataUrl, file: dataUrl, fileName: 'sheet.pdf', walkOnMusic: 'media:def456' },
    ],
    schedule: [{ id: 'c1', time: '8:00', description: 'Open', music: 'media:ghi789', musicName: 'Open.mp3' }],
    hosts: [{ id: 'h1', name: 'Cal', photo: dataUrl, isHosting: true }],
    djSongs: [],
    staff: [],
    vendors: [{ id: 'v1', name: 'Tacos', photo: dataUrl }],
    expenses: [{ id: 'e1', category: 'venue', itemName: 'rent', cost: 100, receiptPhoto: dataUrl }],
    files: [{ id: 'f1', name: 'runsheet.pdf', fileData: dataUrl, fileType: 'application/pdf', uploadedAt: 'now' }],
    createdAt: 'now',
    updatedAt: 'now',
  };
  return show as unknown as Show;
}

describe('stripLegacyShowMedia', () => {
  it('removes every legacy photo/video/file blob', () => {
    const stripped = stripLegacyShowMedia(legacyShow());
    const json = JSON.stringify(stripped);
    expect(json).not.toContain('data:image');
    expect(json).not.toContain('base64');
    expect(json).not.toContain('flyer');
    expect(json).not.toContain('files');
  });

  it('keeps a performer photo that lives in the media store', () => {
    const show = legacyShow();
    show.performers[0].photo = 'media:photo123#1';
    const stripped = stripLegacyShowMedia(show);
    expect(stripped.performers[0].photo).toBe('media:photo123#1');
  });

  it('still throws away a photo embedded as base64', () => {
    const stripped = stripLegacyShowMedia(legacyShow());
    expect(stripped.performers[0].photo).toBeUndefined();
  });

  it('keeps walk-on music references and links', () => {
    const stripped = stripLegacyShowMedia(legacyShow());
    expect(stripped.performers[0].walkOnMusic).toBe('media:abc123');
    expect(stripped.performers[0].walkOnMusicName).toBe('Intro.mp3');
    expect(stripped.performers[0].videoLink).toBe('https://vimeo.com/123');
    expect(stripped.artists[0].walkOnMusic).toBe('media:def456');
    expect(stripped.schedule[0].music).toBe('media:ghi789');
  });
});

describe('stripLegacySettingsMedia', () => {
  it('scrubs rolodex photos, receipts, and trashed shows', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      potentialComics: [{ id: 'c1', name: 'Alice', photo: dataUrl, photos: [dataUrl] }],
      expenses: [{ id: 'e1', category: 'venue', itemName: 'rent', cost: 1, receiptPhoto: dataUrl }],
      trash: [{ id: 't1', type: 'show', data: legacyShow(), deletedAt: 'now' }],
    } as unknown as AppSettings;
    const stripped = stripLegacySettingsMedia(settings);
    expect(JSON.stringify(stripped)).not.toContain('data:image');
    expect(stripped.potentialComics[0].name).toBe('Alice');
  });
});
