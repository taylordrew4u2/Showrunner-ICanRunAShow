import { describe, expect, it } from 'vitest';
import {
  actMinutesField,
  settleActMinutes,
  typeActMinutes,
  type ActMinutesEdit,
} from './ScheduleGenerator';

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
