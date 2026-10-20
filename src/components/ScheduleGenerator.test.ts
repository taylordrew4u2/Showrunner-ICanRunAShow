import { describe, expect, it } from 'vitest';
import {
  actMinutesField,
  previewRowKey,
  settleActMinutes,
  typeActMinutes,
  type ActMinutesEdit,
} from './ScheduleGenerator';
import { generateSchedule } from '../utils/generateSchedule';
import type { Performer } from '../types';

const untouched: ActMinutesEdit = { lengths: {}, drafts: {} };
const DEFAULT_MIN = 10;

/** What the act is scheduled for right now: its override, else the default. */
function scheduled(edit: ActMinutesEdit, id: string) {
  return edit.lengths[id] ?? DEFAULT_MIN;
}

describe("retyping an act's minutes in the generator", () => {
  it('replaces the number rather than appending to the default once the box is cleared', () => {
    // Backspace twice on "10", then type 5. On a phone keypad there is no
    // select-all, so this is the ordinary way to change a number.
    let edit = typeActMinutes(untouched, 'ada', '1');
    expect(actMinutesField(edit, 'ada', scheduled(edit, 'ada'))).toBe('1');

    edit = typeActMinutes(edit, 'ada', '');
    // The box stays blank while it is being edited — it must not snap back to 10.
    expect(actMinutesField(edit, 'ada', scheduled(edit, 'ada'))).toBe('');

    edit = typeActMinutes(edit, 'ada', '5');
    expect(actMinutesField(edit, 'ada', scheduled(edit, 'ada'))).toBe('5');
    expect(scheduled(edit, 'ada')).toBe(5);
  });

  it('runs the act at the default while the box is blank, never at zero', () => {
    const edit = typeActMinutes(typeActMinutes(untouched, 'ada', '7'), 'ada', '');
    expect(edit.lengths.ada).toBeUndefined();
    expect(scheduled(edit, 'ada')).toBe(DEFAULT_MIN);
  });

  it('shows the default again when a blank box is left', () => {
    const edit = settleActMinutes(typeActMinutes(untouched, 'ada', ''), 'ada');
    expect(actMinutesField(edit, 'ada', scheduled(edit, 'ada'))).toBe(DEFAULT_MIN);
  });

  it('keeps the number typed once the box is left', () => {
    const edit = settleActMinutes(typeActMinutes(untouched, 'ada', '12'), 'ada');
    expect(scheduled(edit, 'ada')).toBe(12);
    expect(actMinutesField(edit, 'ada', scheduled(edit, 'ada'))).toBe(12);
  });

  it('caps a set at three hours', () => {
    expect(scheduled(typeActMinutes(untouched, 'ada', '500'), 'ada')).toBe(180);
  });

  it("leaves the other acts' minutes alone", () => {
    const ada = settleActMinutes(typeActMinutes(untouched, 'ada', '8'), 'ada');
    const edit = typeActMinutes(ada, 'jo', '');
    expect(scheduled(edit, 'ada')).toBe(8);
    expect(actMinutesField(edit, 'ada', scheduled(edit, 'ada'))).toBe(8);
  });
});

describe('the rows of the generator preview', () => {
  const ada: Performer = { id: 'ada', name: 'Ada' };
  const ben: Performer = { id: 'ben', name: 'Ben' };
  const preview = (people: Performer[], lengths: Record<string, number>) =>
    generateSchedule({
      acts: people.map((performer) => ({ performer, durationMin: lengths[performer.id] ?? DEFAULT_MIN })),
      hostName: 'Hal',
    });
  type Preview = ReturnType<typeof preview>;
  const actKey = (items: Preview, id: string) => {
    const index = items.findIndex((item) => item.performerId === id);
    return previewRowKey(items[index], index);
  };

  // The preview is rebuilt on every keystroke, and every cue in it gets a new
  // id each time. Keyed by those ids, each digit typed into an act's minutes
  // swapped in a fresh row — and a fresh, unfocused box, so the phone keypad
  // closed after the first digit.
  it('keeps an act’s row as its minutes are typed', () => {
    const before = preview([ada, ben], {});
    const edit = typeActMinutes(untouched, 'ada', '2');
    const after = preview([ada, ben], edit.lengths);
    expect(actKey(after, 'ada')).toBe(actKey(before, 'ada'));
    expect(actKey(after, 'ben')).toBe(actKey(before, 'ben'));
  });

  it('keeps an act’s row when it is moved', () => {
    const before = preview([ada, ben], {});
    const after = preview([ben, ada], {});
    expect(actKey(after, 'ada')).toBe(actKey(before, 'ada'));
  });

  it('gives every row its own key, even for two acts of the same name', () => {
    const items = preview([ada, ben, { id: 'cy', name: 'Ada' }], {});
    expect(new Set(items.map(previewRowKey)).size).toBe(items.length);
  });
});
