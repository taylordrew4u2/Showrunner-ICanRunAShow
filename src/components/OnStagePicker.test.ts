import { describe, expect, it } from 'vitest';
import { linkedPerformerId } from './OnStagePicker';
import type { Performer } from '../types';

const ada: Performer = { id: 'slot-2', name: 'Ada Cole' };
const jo: Performer = { id: 'slot-3', name: 'Jo Park' };
const bill = [ada, jo];

describe('the on-stage picker on a cue whose performer link went stale', () => {
  it('shows the performer the cue still names when they were removed and booked again', () => {
    // Removed and re-added from the Rolodex: the cue keeps slot-1, she is now slot-2.
    expect(linkedPerformerId({ performerId: 'slot-1', performer: 'Ada Cole' }, bill)).toBe('slot-2');
  });

  it('shows a live link as it is', () => {
    expect(linkedPerformerId({ performerId: 'slot-3', performer: 'Jo Park' }, bill)).toBe('slot-3');
  });

  it('shows the typed name rather than nobody when the link points at no one on the bill', () => {
    // No id to select, so the picker falls through to the name it still has.
    expect(linkedPerformerId({ performerId: 'slot-1', performer: 'Sam Ortiz' }, bill)).toBe('');
  });

  it('does not turn a typed name into a link', () => {
    // A guest typed by name stays "someone else" even if a booked performer shares it.
    expect(linkedPerformerId({ performer: 'Ada Cole' }, bill)).toBe('');
    expect(linkedPerformerId({}, bill)).toBe('');
  });
});
