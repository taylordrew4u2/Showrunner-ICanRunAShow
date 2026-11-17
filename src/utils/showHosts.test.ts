import { describe, expect, it } from 'vitest';
import type { Show } from '../types';
import {
  editHost, hostCueNames, hostHandle, hostNames, hostWithHandle, joinHosts, pickHost, promoteCoHost, removeHost,
  retypeHost, retypeHostSocial, showHosts,
} from './showHosts';

const show = (over: Partial<Show> = {}): Show => ({
  id: 'show', name: 'Basement Hour', date: '2026-12-01', time: '20:00', location: '', venueName: '', status: 'upcoming',
  performers: [], artists: [], schedule: [], hosts: [], djSongs: [], staff: [], expenses: [],
  createdAt: '2026-09-15', updatedAt: '2026-09-15', ...over,
});

describe('who is hosting', () => {
  it('reads a show saved with the one host it could have, with nothing done to it', () => {
    const legacy = show({ host: 'Jo Park' });
    expect(showHosts(legacy)).toEqual([{ slot: 'host', name: 'Jo Park', social: undefined, comicId: undefined }]);
    expect(hostNames(legacy)).toEqual(['Jo Park']);
  });

  it('lists two hosts in order, each with their handle and their Rolodex link', () => {
    const hosts = showHosts(show({
      host: ' Jo Park ', hostSocial: '@jopark', hostComicId: 'c-jo',
      coHost: 'Dev Okonjo', coHostSocial: ' https://instagram.com/devokonjo ',
    }));
    expect(hosts).toEqual([
      { slot: 'host', name: 'Jo Park', social: '@jopark', comicId: 'c-jo' },
      { slot: 'coHost', name: 'Dev Okonjo', social: 'https://instagram.com/devokonjo', comicId: undefined },
    ]);
    expect(hosts.map(hostHandle)).toEqual(['@jopark', '@devokonjo']);
    expect(hosts.map(hostWithHandle)).toEqual(['Jo Park @jopark', 'Dev Okonjo @devokonjo']);
  });

  it('counts a slot with no name as nobody, whatever was left beside it', () => {
    expect(showHosts(show({ host: '   ', hostSocial: '@nobody', coHost: 'Dev Okonjo' })).map((h) => h.name)).toEqual(['Dev Okonjo']);
    expect(showHosts(show())).toEqual([]);
  });

  it('words one host and two the same way everywhere', () => {
    expect(joinHosts(['Jo Park'])).toBe('Jo Park');
    expect(joinHosts(['Jo Park', 'Dev Okonjo'])).toBe('Jo Park and Dev Okonjo');
    expect(joinHosts([])).toBe('');
  });

  it('names a host with no handle, or a social that is not one, by name alone', () => {
    expect(hostWithHandle({ name: 'Jo Park' })).toBe('Jo Park');
    expect(hostWithHandle({ name: 'Jo Park', social: 'https://youtube.com/channel/UC123' })).toBe('Jo Park');
  });

  it('knows every name a host’s cue can carry, the two together included', () => {
    expect(hostCueNames(['Jo Park', undefined])).toEqual(['Jo Park']);
    expect(hostCueNames([' Jo Park ', 'Dev Okonjo'])).toEqual(['Jo Park', 'Dev Okonjo', 'Jo Park and Dev Okonjo']);
    expect(hostCueNames([undefined, ''])).toEqual([]);
  });
});

describe('setting the hosts', () => {
  it('types a host and a handle by hand, and stores an empty one as no host', () => {
    const typed = retypeHostSocial(retypeHost(show(), 'host', 'Jo Park'), 'host', '@jopark');
    expect(typed).toMatchObject({ host: 'Jo Park', hostSocial: '@jopark' });
    expect(typed.hostComicId).toBeUndefined();
    expect(retypeHost(typed, 'host', '').host).toBeUndefined();
    expect(retypeHostSocial(typed, 'host', '').hostSocial).toBeUndefined();
  });

  it('adds a second host without touching the first', () => {
    const first = show({ host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' });
    const both = retypeHostSocial(retypeHost(first, 'coHost', 'Dev Okonjo'), 'coHost', '@devokonjo');
    expect(both).toMatchObject({
      host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo', coHost: 'Dev Okonjo', coHostSocial: '@devokonjo',
    });
  });

  it('takes the handle and the link with someone picked from the Rolodex', () => {
    const picked = pickHost(show({ host: 'Old Host', hostSocial: '@oldhost' }), 'host', { name: ' Jo Park ', social: '@jopark', comicId: 'c-jo' });
    expect(picked).toMatchObject({ host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' });
    // Someone on file with no handle saved has none: the last host's is not theirs.
    const bare = pickHost(picked, 'host', { name: 'Dev Okonjo', comicId: 'c-dev' });
    expect(bare).toMatchObject({ host: 'Dev Okonjo', hostComicId: 'c-dev' });
    expect(bare.hostSocial).toBeUndefined();
  });

  it('drops the link and the handle when a different name is typed over a picked host', () => {
    const picked = show({ host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' });
    const retyped = retypeHost(picked, 'host', 'Jo Parker');
    expect(retyped.host).toBe('Jo Parker');
    expect(retyped.hostComicId).toBeUndefined();
    expect(retyped.hostSocial).toBeUndefined();
  });

  it('keeps the link through a change of case or spacing, which is the same person', () => {
    const picked = show({ host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' });
    expect(retypeHost(picked, 'host', 'jo  park ')).toMatchObject({ host: 'jo  park ', hostSocial: '@jopark', hostComicId: 'c-jo' });
  });

  it('keeps a hand-typed handle when a hand-typed name is corrected', () => {
    const typed = show({ host: 'Jo Prak', hostSocial: '@jopark' });
    expect(retypeHost(typed, 'host', 'Jo Park')).toMatchObject({ host: 'Jo Park', hostSocial: '@jopark' });
  });

  it('removes either host, and the one left is the host', () => {
    const both = show({
      host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo',
      coHost: 'Dev Okonjo', coHostSocial: '@devokonjo', coHostComicId: 'c-dev',
    });
    const withoutSecond = removeHost(both, 'coHost');
    expect(showHosts(withoutSecond)).toEqual([{ slot: 'host', name: 'Jo Park', social: '@jopark', comicId: 'c-jo' }]);
    expect(withoutSecond.coHostSocial).toBeUndefined();
    expect(withoutSecond.coHostComicId).toBeUndefined();

    const withoutFirst = removeHost(both, 'host');
    expect(showHosts(withoutFirst)).toEqual([{ slot: 'host', name: 'Dev Okonjo', social: '@devokonjo', comicId: 'c-dev' }]);
    expect(withoutFirst.coHost).toBeUndefined();
    expect(showHosts(removeHost(withoutFirst, 'host'))).toEqual([]);
  });

  it('leaves a show with a first host, or with none, as it is', () => {
    const one = show({ host: 'Jo Park' });
    expect(promoteCoHost(one)).toBe(one);
    const none = show();
    expect(promoteCoHost(none)).toBe(none);
  });
});

describe('a host set by name and handle alone', () => {
  const picked = show({ host: 'Jo Park', hostSocial: '@jopark', hostComicId: 'c-jo' });

  it('sets a name, a handle or both', () => {
    expect(editHost(show(), 'host', { name: 'Jo Park', social: ' @jopark ' })).toMatchObject({ host: 'Jo Park', hostSocial: '@jopark' });
    expect(editHost(show({ host: 'Jo Park' }), 'coHost', { name: 'Dev Okonjo' })).toMatchObject({ host: 'Jo Park', coHost: 'Dev Okonjo' });
  });

  it('makes a changed handle the host’s own, so the Rolodex’s is not put back over it', () => {
    const edited = editHost(picked, 'host', { social: '@jo.park.comedy' });
    expect(edited).toMatchObject({ host: 'Jo Park', hostSocial: '@jo.park.comedy' });
    expect(edited.hostComicId).toBeUndefined();
  });

  it('keeps the link when the handle sent is the one already there', () => {
    expect(editHost(picked, 'host', { name: 'Jo Park', social: '@jopark' })).toMatchObject({ hostComicId: 'c-jo' });
  });

  it('clears the handle and the link with the name', () => {
    const cleared = editHost(picked, 'host', { name: '' });
    expect(cleared.host).toBeUndefined();
    expect(cleared.hostSocial).toBeUndefined();
    expect(cleared.hostComicId).toBeUndefined();
  });
});
