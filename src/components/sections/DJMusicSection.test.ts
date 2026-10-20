import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MusicTrack, Show } from '../../types';
import { DJMusicSection } from './DJMusicSection';

const show: Show = {
  id: 's1', name: 'Friday', date: '', time: '', location: '', venueName: '',
  status: 'upcoming', performers: [], artists: [], schedule: [], hosts: [],
  djSongs: [{ id: 'own1', title: 'Birthday song', artist: 'Dana' }],
  staff: [], vendors: [], expenses: [], scenes: [],
  createdAt: '', updatedAt: '',
};

const library: MusicTrack[] = [
  { id: 't1', title: 'Intro Bed', artist: 'Band', music: 'media:abc#2', musicName: 'intro.mp3', addedAt: '' },
];

describe('naming the DJ list controls for a screen reader', () => {
  it('says which song each × removes', () => {
    // On its own the × reads as "times, button" on every row, with nothing to
    // say which song it takes off the show or that it takes anything off.
    const html = renderToStaticMarkup(createElement(DJMusicSection, { show, library, onUpdate: () => undefined }));
    const deletes = html.match(/<button[^>]*section-list-item__delete[^>]*>/g) ?? [];
    expect(deletes).toHaveLength(2);
    expect(deletes[0]).toContain('aria-label="Remove Birthday song from this show"');
    expect(deletes[1]).toContain('aria-label="Remove Intro Bed from this show"');
  });
});
