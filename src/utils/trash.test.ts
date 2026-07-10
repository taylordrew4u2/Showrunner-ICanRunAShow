import { describe, it, expect } from 'vitest';
import { stripShowMediaForTrash, MAX_TRASH_ITEMS } from './trash';
import type { Show } from '../types';

const dataUrl = 'data:audio/mpeg;base64,' + 'A'.repeat(500);

function makeShow(): Show {
  return {
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
        photos: [dataUrl, 'https://example.com/alice.jpg'],
        walkOnMusic: dataUrl,
        walkOnMusicName: 'Intro.mp3',
        walkOnMusicLink: 'https://youtube.com/watch?v=x',
        video: dataUrl,
        videoLink: 'https://vimeo.com/123',
      },
    ],
    artists: [
      { id: 'a1', name: 'Bea', photo: dataUrl, walkOnMusic: dataUrl, video: dataUrl, file: dataUrl, fileName: 'sheet.pdf' },
    ],
    schedule: [{ id: 'c1', time: '8:00', description: 'Open', music: dataUrl, musicName: 'Open.mp3' }],
    hosts: [{ id: 'h1', name: 'Cal', photo: dataUrl, isHosting: true }],
    djSongs: [],
    staff: [],
    vendors: [{ id: 'v1', name: 'Tacos', photo: dataUrl }],
    expenses: [{ id: 'e1', category: 'venue', itemName: 'rent', cost: 100, receiptPhoto: dataUrl }],
    files: [{ id: 'f1', name: 'runsheet.pdf', fileData: dataUrl, fileType: 'application/pdf', uploadedAt: 'now' }],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

describe('stripShowMediaForTrash', () => {
  it('removes every embedded data: URL', () => {
    const stripped = stripShowMediaForTrash(makeShow());
    const json = JSON.stringify(stripped);
    expect(json).not.toContain('data:audio');
    expect(json).not.toContain('base64');
  });

  it('keeps names, links, and non-media fields', () => {
    const stripped = stripShowMediaForTrash(makeShow());
    expect(stripped.name).toBe('Comedy Night');
    expect(stripped.performers[0].name).toBe('Alice');
    expect(stripped.performers[0].walkOnMusicName).toBe('Intro.mp3');
    expect(stripped.performers[0].walkOnMusicLink).toBe('https://youtube.com/watch?v=x');
    expect(stripped.performers[0].videoLink).toBe('https://vimeo.com/123');
    expect(stripped.performers[0].photos).toEqual(['https://example.com/alice.jpg']);
    expect(stripped.artists[0].fileName).toBe('sheet.pdf');
    expect(stripped.schedule[0].musicName).toBe('Open.mp3');
  });

  it('empties uploaded files entirely', () => {
    const stripped = stripShowMediaForTrash(makeShow());
    expect(stripped.files).toEqual([]);
  });

  it('does not mutate the original show', () => {
    const show = makeShow();
    stripShowMediaForTrash(show);
    expect(show.performers[0].walkOnMusic).toBe(dataUrl);
    expect(show.files).toHaveLength(1);
  });

  it('exports a sane trash cap', () => {
    expect(MAX_TRASH_ITEMS).toBeGreaterThan(0);
    expect(MAX_TRASH_ITEMS).toBeLessThanOrEqual(50);
  });
});
