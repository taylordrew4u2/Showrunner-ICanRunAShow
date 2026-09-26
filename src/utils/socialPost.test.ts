import { describe, expect, it } from 'vitest';
import { buildSocialPost, postTags, toHandle, untaggedNames } from './socialPost';
import type { Show } from '../types';

function show(overrides: Partial<Show> = {}): Show {
  return {
    id: 's1',
    name: 'Basement Hour',
    date: '2026-03-12',
    time: '20:00',
    location: '14 Wharf St',
    venueName: 'The Cellar',
    status: 'upcoming',
    performers: [],
    artists: [],
    schedule: [],
    hosts: [],
    djSongs: [],
    staff: [],
    expenses: [],
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  } as Show;
}

describe('toHandle', () => {
  it('takes the handle however the producer typed it', () => {
    expect(toHandle('@monasable')).toBe('@monasable');
    expect(toHandle('monasable')).toBe('@monasable');
    expect(toHandle('  @monasable  ')).toBe('@monasable');
  });

  it('pulls the handle out of a pasted profile link', () => {
    expect(toHandle('https://instagram.com/monasable')).toBe('@monasable');
    expect(toHandle('https://www.tiktok.com/@mona.sable')).toBe('@mona.sable');
    expect(toHandle('instagram.com/monasable/')).toBe('@monasable');
  });

  it('treats a blank or a sentence as no handle at all', () => {
    expect(toHandle(undefined)).toBeNull();
    expect(toHandle('   ')).toBeNull();
    expect(toHandle('ask her for it')).toBeNull();
  });
});

describe('postTags', () => {
  it('collects the bill in billing order', () => {
    const tags = postTags(
      show({
        performers: [
          { id: 'p1', name: 'Renata Cruz', socialMedia: '@renatadoesbits' },
          { id: 'p2', name: 'Mona Sable', socialMedia: 'monasable' },
        ],
      }),
    );

    expect(tags).toEqual(['@renatadoesbits', '@monasable']);
  });

  it('does not tag the same account twice when someone is on twice', () => {
    const tags = postTags(
      show({
        performers: [
          { id: 'p1', name: 'Renata Cruz', socialMedia: '@renatadoesbits' },
          { id: 'p2', name: 'Renata Cruz (closing)', socialMedia: '@RenataDoesBits' },
        ],
      }),
    );

    expect(tags).toEqual(['@renatadoesbits']);
  });

  it('includes artists, who are on the bill too', () => {
    const tags = postTags(
      show({
        performers: [{ id: 'p1', name: 'Mona Sable', socialMedia: '@monasable' }],
        artists: [{ id: 'a1', name: 'Odile Marchand', socialMedia: '@odilemarchand' }],
      }),
    );

    expect(tags).toEqual(['@monasable', '@odilemarchand']);
  });
});

describe('untaggedNames', () => {
  it('names anyone with no handle, so the gap is visible before posting', () => {
    const missing = untaggedNames(
      show({
        performers: [
          { id: 'p1', name: 'Mona Sable', socialMedia: '@monasable' },
          { id: 'p2', name: 'Dev Okonjo' },
        ],
      }),
    );

    expect(missing).toEqual(['Dev Okonjo']);
  });
});

describe('buildSocialPost', () => {
  it('writes the whole caption from the booking', () => {
    const post = buildSocialPost(
      show({
        ticketLink: 'https://icanrunashow.com/live/cellar-thu',
        performers: [
          { id: 'p1', name: 'Renata Cruz', socialMedia: '@renatadoesbits' },
          { id: 'p2', name: 'Dev Okonjo' },
        ],
      }),
    );

    expect(post.text).toBe(
      [
        'BASEMENT HOUR',
        // In words, as the cards print it — never the stored "2026-03-12 · 20:00".
        `${new Date(2026, 2, 12).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${new Date(2000, 0, 1, 20, 0).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
        'The Cellar, 14 Wharf St',
        '',
        'Renata Cruz @renatadoesbits',
        'Dev Okonjo',
        '',
        'Tickets: https://icanrunashow.com/live/cellar-thu',
        '',
        '@renatadoesbits',
      ].join('\n'),
    );
    expect(post.tags).toEqual(['@renatadoesbits']);
    expect(post.untagged).toEqual(['Dev Okonjo']);
  });

  it('always names the host, who is on the bill but not in the performer list', () => {
    const post = buildSocialPost(show({
      host: 'Jo Park',
      performers: [{ id: 'p1', name: 'Renata Cruz', socialMedia: '@renatadoesbits' }],
    }));
    const lines = post.text.split('\n');
    expect(lines[3]).toBe('Hosted by Jo Park');
    // Before the bill, so the host reads as the host and not as the last act on.
    expect(lines.indexOf('Hosted by Jo Park')).toBeLessThan(lines.indexOf('Renata Cruz @renatadoesbits'));
  });

  it('takes the host from the hosts list when the host field is empty, with their handle if they perform too', () => {
    const post = buildSocialPost(show({
      hosts: [
        { id: 'h1', name: 'Dev Okonjo', isHosting: true },
        { id: 'h2', name: 'Someone Else', isHosting: false },
      ],
      performers: [{ id: 'p1', name: 'Dev Okonjo', socialMedia: '@devokonjo' }],
    }));
    expect(post.text).toContain('Hosted by Dev Okonjo @devokonjo');
    expect(post.text).not.toContain('Someone Else');
  });

  it('leaves out the ticket line when there is no link to give', () => {
    const post = buildSocialPost(show());

    expect(post.text).not.toContain('Tickets:');
    expect(post.tags).toEqual([]);
  });
});
