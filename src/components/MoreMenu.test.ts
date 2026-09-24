import { describe, expect, it } from 'vitest';
import { menuItemReachedByKey } from './MoreMenu';

describe('moving through the more menu with the keyboard', () => {
  // A four-item menu: Duplicate, Share, Print, Delete.
  const reach = (key: string, index: number) => menuItemReachedByKey(key, index, 4);

  it('steps an item at a time with the up and down arrows', () => {
    expect(reach('ArrowDown', 1)).toBe(2);
    expect(reach('ArrowUp', 2)).toBe(1);
  });

  it('wraps from the last item to the first and back', () => {
    expect(reach('ArrowDown', 3)).toBe(0);
    expect(reach('ArrowUp', 0)).toBe(3);
  });

  it('jumps to the first and last item with Home and End', () => {
    expect(reach('Home', 2)).toBe(0);
    expect(reach('End', 1)).toBe(3);
  });

  it('stays put in a one-item menu', () => {
    expect(menuItemReachedByKey('ArrowDown', 0, 1)).toBe(0);
    expect(menuItemReachedByKey('ArrowUp', 0, 1)).toBe(0);
  });

  it('leaves every other key alone', () => {
    expect(reach('Enter', 1)).toBeNull();
    expect(reach('Tab', 1)).toBeNull();
    expect(reach('Escape', 1)).toBeNull();
    expect(reach('a', 1)).toBeNull();
  });
});
