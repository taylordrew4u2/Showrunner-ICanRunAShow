import { describe, expect, it } from 'vitest';
import { syncAnnouncement } from './SyncStatus';

describe('what a screen reader hears from the sync pill', () => {
  it('stays quiet through the save that follows every pause in typing', () => {
    expect(syncAnnouncement('saved', 'saving')).toBeNull();
    expect(syncAnnouncement('saved', 'saved')).toBeNull();
  });

  it('says when work is being held on this device, offline, or needs the user', () => {
    expect(syncAnnouncement('saved', 'retrying')).toBe('Held safely on this device');
    expect(syncAnnouncement('saved', 'offline')).toBe("You're offline");
    expect(syncAnnouncement('saved', 'blocked')).toBe('One change needs your attention');
    expect(syncAnnouncement('offline', 'retrying')).toBe('Held safely on this device');
  });

  it('says when held work is back on the account, and only then', () => {
    expect(syncAnnouncement('retrying', 'saved')).toBe('Everything is saved');
    expect(syncAnnouncement('offline', 'saved')).toBe('Everything is saved');
    expect(syncAnnouncement('blocked', 'saved')).toBe('Everything is saved');
  });

  it('does not repeat itself on every retry attempt while held', () => {
    expect(syncAnnouncement('retrying', 'saving')).toBeNull();
    expect(syncAnnouncement('retrying', 'retrying')).toBeNull();
    expect(syncAnnouncement('offline', 'offline')).toBeNull();
  });
});
