import { describe, it, expect } from 'vitest';
import { describeLargestMedia } from './showSize';
import type { Show } from '../types';

const blob = (mb: number) => 'data:audio/mpeg;base64,' + 'A'.repeat(Math.round((mb * 1024 * 1024) / 0.75));

function baseShow(): Show {
  return {
    id: 's1',
    name: 'May 28th',
    date: '2026-05-28',
    time: '',
    location: '',
    venueName: '',
    status: 'upcoming',
    performers: [],
    artists: [],
    schedule: [],
    hosts: [],
    djSongs: [],
    staff: [],
    vendors: [],
    expenses: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

describe('describeLargestMedia', () => {
  it('names the biggest embedded files with sizes, largest first', () => {
    const show = baseShow();
    show.performers = [
      { id: 'p1', name: 'Alice', walkOnMusic: blob(8) },
      { id: 'p2', name: 'Bea', walkOnMusic: blob(1) },
    ];
    show.artists = [{ id: 'a1', name: 'Cal', walkOnMusic: blob(3) }];
    const desc = describeLargestMedia(show);
    expect(desc).toContain('Alice — walk-on music (8.0 MB)');
    expect(desc.indexOf('Alice')).toBeLessThan(desc.indexOf('Cal'));
    expect(desc).toContain('Cal — walk-on music (3.0 MB)');
  });

  it('caps the list at the limit', () => {
    const show = baseShow();
    show.performers = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      walkOnMusic: blob(1),
    }));
    const desc = describeLargestMedia(show, 3);
    expect(desc.split(',').length).toBe(3);
  });

  it('ignores plain links and empty shows', () => {
    const show = baseShow();
    show.performers = [{ id: 'p1', name: 'Alice', walkOnMusicLink: 'https://youtube.com/x' }];
    expect(describeLargestMedia(show)).toBe('');
  });

  it('ignores media-store references', () => {
    const show = baseShow();
    show.performers = [{ id: 'p1', name: 'Alice', walkOnMusic: 'media:abc123' }];
    expect(describeLargestMedia(show)).toBe('');
  });

  it('covers cue music', () => {
    const show = baseShow();
    show.schedule = [{ id: 'c1', time: '8:00', description: 'Opener', music: blob(1) }];
    const desc = describeLargestMedia(show, 5);
    expect(desc).toContain('cue "Opener" — music');
  });
});
