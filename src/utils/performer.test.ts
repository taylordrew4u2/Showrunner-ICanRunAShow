import { describe, expect, it } from 'vitest';
import type { Performer } from '../types';
import { syncPerformerCover } from './performer';

function perf(partial: Partial<Performer>): Performer {
  return { id: 'p1', name: 'Sam', ...partial };
}

describe('syncPerformerCover', () => {
  it('sets the legacy photo to photos[0]', () => {
    const out = syncPerformerCover(perf({ photos: ['a', 'b'], photo: 'stale' }));
    expect(out.photo).toBe('a');
    expect(out.photos).toEqual(['a', 'b']);
  });

  it('normalizes an empty photos array to undefined and leaves photo untouched', () => {
    const out = syncPerformerCover(perf({ photos: [], photo: 'legacy' }));
    expect(out.photos).toBeUndefined();
    expect(out.photo).toBe('legacy');
  });

  it('keeps the legacy single photo when there is no gallery', () => {
    const out = syncPerformerCover(perf({ photo: 'legacy' }));
    expect(out.photo).toBe('legacy');
    expect(out.photos).toBeUndefined();
  });

  it('returns the same reference when nothing changes', () => {
    const p = perf({ photos: ['a'], photo: 'a' });
    expect(syncPerformerCover(p)).toBe(p);
  });
});
