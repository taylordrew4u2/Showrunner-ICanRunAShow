import { describe, it, expect } from 'vitest';
import { expandOriginFrom } from './expandOrigin';

const main = { left: 0, top: 0, width: 1000, height: 500 };

describe('expandOriginFrom', () => {
  it('puts the origin at the centre of the card, as a percentage of the container', () => {
    expect(expandOriginFrom({ left: 400, top: 200, width: 200, height: 100 }, main)).toEqual({ x: 50, y: 50 });
  });

  it('is relative to the container, not the viewport', () => {
    // Card centre is (600, 300); the container starts at (100, 50) and is
    // 1000x500, so that centre is dead centre of the container.
    const offset = { left: 100, top: 50, width: 1000, height: 500 };
    expect(expandOriginFrom({ left: 500, top: 250, width: 200, height: 100 }, offset)).toEqual({ x: 50, y: 50 });
  });

  it('clamps a card scrolled outside the container', () => {
    expect(expandOriginFrom({ left: -900, top: -400, width: 200, height: 100 }, main)).toEqual({ x: 0, y: 0 });
    expect(expandOriginFrom({ left: 5000, top: 5000, width: 200, height: 100 }, main)).toEqual({ x: 100, y: 100 });
  });

  // Each of these used to divide by zero or read a property of null inside the
  // click handler. React does not route event-handler errors to an error
  // boundary, so the throw was invisible and the show just never opened.
  it('returns null rather than dividing by a zero-size container', () => {
    expect(expandOriginFrom({ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 0, height: 500 })).toBeNull();
    expect(expandOriginFrom({ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 1000, height: 0 })).toBeNull();
  });

  it('returns null when either rect is missing', () => {
    expect(expandOriginFrom(null, main)).toBeNull();
    expect(expandOriginFrom({ left: 0, top: 0, width: 10, height: 10 }, null)).toBeNull();
    expect(expandOriginFrom(undefined, undefined)).toBeNull();
  });

  it('returns null rather than emitting NaN', () => {
    expect(expandOriginFrom({ left: NaN, top: 0, width: 10, height: 10 }, main)).toBeNull();
    expect(expandOriginFrom({ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: NaN, height: 500 })).toBeNull();
  });
});
