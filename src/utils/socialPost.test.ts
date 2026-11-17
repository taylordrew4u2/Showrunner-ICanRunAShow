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
    expect(toHandle('https://www.instagram.com/monasable/?hl=en')).toBe('@monasable');
    expect(toHandle('https://x.com/monasable')).toBe('@monasable');
    expect(toHandle('https://twitter.com/monasable')).toBe('@monasable');
    expect(toHandle('https://www.threads.net/@monasable')).toBe('@monasable');
    expect(toHandle('https://youtube.com/@monasable')).toBe('@monasable');
  });

  it('does not take a profile link apart where its first part is not a handle', () => {
    // These were tagged "@channel", "@c", "@user", "@profile.php" and "@p".
    expect(toHandle('https://youtube.com/channel/UC123')).toBeNull();
    expect(toHandle('https://www.youtube.com/c/janecomedy')).toBeNull();
    expect(toHandle('youtube.com/user/janecomedy')).toBeNull();
    expect(toHandle('https://www.facebook.com/profile.php?id=1000')).toBeNull();
    expect(toHandle('https://instagram.com/p/abc')).toBeNull();
    expect(toHandle('https://www.instagram.com/reel/abc/')).toBeNull();
    // TikTok's own Share button copies a link like this one. It was "@t".
    expect(toHandle('https://www.tiktok.com/t/ZT8abc/')).toBeNull();
    expect(toHandle('https://www.tiktok.com/@mona.sable/video/7301')).toBe('@mona.sable');
  });

  it('does not make a handle out of a link to anywhere else', () => {
    // Was "@https://my-site.com/jane", tag and all.
    expect(toHandle('https://my-site.com/jane')).toBeNull();
    expect(toHandle('janecomedy.com/about')).toBeNull();
  });

  it('still reads a handle with a dot in it as a handle, not a web address', () => {
    expect(toHandle('mona.sable')).toBe('@mona.sable');
    expect(toHandle('@mona.sable')).toBe('@mona.sable');
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
    expect(post.withheld).toEqual([]);
  });
});

describe('a post with a surprise guest on the bill', () => {
  const booked = show({
    performers: [
      { id: 'p1', name: 'Renata Cruz', socialMedia: '@renatadoesbits' },
      { id: 'g1', name: 'Miles Trent', socialMedia: '@milestrent', surpriseGuest: true },
      { id: 'g2', name: 'Rae Sun', surpriseGuest: true },
    ],
  });

  it('names and tags nobody kept for a surprise, anywhere in the caption', () => {
    const post = buildSocialPost(booked);
    expect(post.text).toContain('Renata Cruz @renatadoesbits');
    expect(post.text).not.toMatch(/Miles Trent|milestrent|Rae Sun/);
    expect(post.tags).toEqual(['@renatadoesbits']);
    expect(postTags(booked)).toEqual(['@renatadoesbits']);
  });

  it('does not list a guest with no handle as someone to chase for one', () => {
    expect(untaggedNames(booked)).toEqual([]);
    expect(buildSocialPost(booked).untagged).toEqual([]);
  });

  it('tells the producer who it left off, so a missing name reads as kept back, not forgotten', () => {
    expect(buildSocialPost(booked).withheld).toEqual(['Miles Trent', 'Rae Sun']);
  });

  it('does not hand the host the handle of a guest who shares their name', () => {
    const post = buildSocialPost({ ...booked, host: 'Miles Trent' });
    expect(post.text).toContain('Hosted by Miles Trent');
    expect(post.text).not.toContain('@milestrent');
  });
});

describe('a post for a night with hosts and their handles', () => {
  const bill = [
    { id: 'p1', name: 'Renata Cruz', socialMedia: '@renatadoesbits' },
    { id: 'p2', name: 'Dev Okonjo' },
  ];

  it('names two hosts on one line, each with their own handle', () => {
    const post = buildSocialPost(show({
      host: 'Jo Park', hostSocial: '@jopark',
      coHost: 'Mona Sable', coHostSocial: 'https://www.instagram.com/monasable/',
      performers: bill,
    }));
    const lines = post.text.split('\n');
    expect(lines[3]).toBe('Hosted by Jo Park @jopark and Mona Sable @monasable');
    expect(lines.indexOf(lines[3])).toBeLessThan(lines.indexOf('Renata Cruz @renatadoesbits'));
  });

  it('tags the hosts alongside the bill, hosts first and nobody twice', () => {
    const hosted = show({
      host: 'Jo Park', hostSocial: '@jopark',
      // Hosting and performing: one person, one tag.
      coHost: 'Renata Cruz', coHostSocial: '@RenataDoesBits',
      performers: bill,
    });
    expect(postTags(hosted)).toEqual(['@jopark', '@RenataDoesBits']);
    expect(buildSocialPost(hosted).text.split('\n').at(-1)).toBe('@jopark @RenataDoesBits');
  });

  it('gives a host with no handle of their own the one they carry on the bill', () => {
    const post = buildSocialPost(show({ host: 'Renata Cruz', performers: bill }));
    expect(post.text).toContain('Hosted by Renata Cruz @renatadoesbits');
  });

  it('prefers the handle saved beside the host to the one on their booking', () => {
    const post = buildSocialPost(show({ host: 'Renata Cruz', hostSocial: '@renatahosts', performers: bill }));
    expect(post.text).toContain('Hosted by Renata Cruz @renatahosts');
  });

  it('names a host with no handle as someone to chase, once', () => {
    const hosted = show({ host: 'Jo Park', coHost: 'Dev Okonjo', performers: bill });
    expect(buildSocialPost(hosted).text).toContain('Hosted by Jo Park and Dev Okonjo');
    // Dev is on the bill, and is listed there.
    expect(untaggedNames(hosted)).toEqual(['Jo Park', 'Dev Okonjo']);
    expect(untaggedNames(show({ host: 'Jo Park', hostSocial: '@jopark', performers: bill }))).toEqual(['Dev Okonjo']);
  });

  it('leaves a host’s social that is not a handle out of the tags', () => {
    const hosted = show({ host: 'Jo Park', hostSocial: 'https://youtube.com/channel/UC123' });
    expect(buildSocialPost(hosted).text).toContain('Hosted by Jo Park');
    expect(postTags(hosted)).toEqual([]);
    expect(untaggedNames(hosted)).toEqual(['Jo Park']);
  });
});
