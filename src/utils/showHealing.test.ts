import { describe, it, expect } from 'vitest';
import { healShow } from './showHealing';
import { buildOverview } from './showsOverview';

describe('healShow', () => {
  it('keeps a show whose list fields were never written', () => {
    // What the shows page does to every row, unguarded, on every render.
    const healed = healShow({ id: 'a', name: 'Late Night' });
    expect(healed).not.toBeNull();
    expect(healed!.performers).toEqual([]);
    expect(healed!.artists).toEqual([]);
    expect(healed!.schedule).toEqual([]);
    expect(healed!.hosts).toEqual([]);
    expect(healed!.djSongs).toEqual([]);
    expect(healed!.staff).toEqual([]);
    expect(healed!.expenses).toEqual([]);
  });

  it('lets a partial show through the dashboard that used to throw on it', () => {
    const healed = healShow({ id: 'a', name: 'Late Night', date: '2026-08-20' });
    expect(() => buildOverview([healed!], new Date(2026, 7, 14))).not.toThrow();
    expect(buildOverview([healed!], new Date(2026, 7, 14)).upcomingCount).toBe(1);
  });

  it('preserves everything it does not have to repair', () => {
    const performers = [{ id: 'p', name: 'Ada Cole' }];
    const healed = healShow({
      id: 'a',
      name: 'Late Night',
      date: '2026-08-20',
      time: '20:00',
      venueName: 'The Cellar',
      status: 'in-progress',
      performers,
    });
    expect(healed!.name).toBe('Late Night');
    expect(healed!.date).toBe('2026-08-20');
    expect(healed!.time).toBe('20:00');
    expect(healed!.venueName).toBe('The Cellar');
    expect(healed!.status).toBe('in-progress');
    expect(healed!.performers).toBe(performers);
  });

  it('replaces a status it cannot render with one it can', () => {
    expect(healShow({ id: 'a', status: 'archived' })!.status).toBe('upcoming');
  });

  it('names an unnamed show rather than listing a blank row', () => {
    expect(healShow({ id: 'a' })!.name).toBe('Untitled show');
  });

  it('drops a list field that came back as something other than a list', () => {
    const healed = healShow({ id: 'a', vendors: 'none', scenes: 3 });
    expect(healed!.vendors).toBeUndefined();
    expect(healed!.scenes).toBeUndefined();
  });

  it('rejects a blob with nothing to identify it by', () => {
    // No id means it can't be opened, edited, or saved back — the row has to
    // stay ciphertext rather than become a card that breaks on touch.
    expect(healShow({ name: 'Late Night' })).toBeNull();
    expect(healShow({ id: '' })).toBeNull();
    expect(healShow(null)).toBeNull();
    expect(healShow('a show')).toBeNull();
    expect(healShow([{ id: 'a' }])).toBeNull();
  });
});
