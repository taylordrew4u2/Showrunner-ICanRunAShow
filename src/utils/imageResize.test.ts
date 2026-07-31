import { describe, it, expect } from 'vitest';
import { fitWithin } from './imageResize';

describe('fitWithin', () => {
  it('leaves an image that already fits alone', () => {
    expect(fitWithin(400, 300, 640)).toEqual({ width: 400, height: 300 });
    expect(fitWithin(640, 640, 640)).toEqual({ width: 640, height: 640 });
  });

  it('scales the longest edge down to the box, keeping the ratio', () => {
    expect(fitWithin(4000, 3000, 640)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(3000, 4000, 640)).toEqual({ width: 480, height: 640 });
  });

  it('rounds to whole pixels', () => {
    expect(fitWithin(1001, 777, 640)).toEqual({ width: 640, height: 497 });
  });

  it('never rounds an extreme aspect ratio down to a zero edge', () => {
    // Canvas rejects a zero dimension, so the short edge floors at 1px.
    expect(fitWithin(10000, 3, 640)).toEqual({ width: 640, height: 1 });
  });

  it('returns nothing drawable for a degenerate image', () => {
    expect(fitWithin(0, 0, 640)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(100, 0, 640)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(Number.NaN, 100, 640)).toEqual({ width: 0, height: 0 });
  });
});
