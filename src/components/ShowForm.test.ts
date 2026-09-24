import { describe, expect, it } from 'vitest';
import { storedShowTime } from './ShowForm';
import { clockLabel } from '../utils/elapsed';

describe('the time typed on the New Show form', () => {
  it('is saved as the clock time the show page and timeline read', () => {
    expect(storedShowTime('Doors 8:30 Show 9')).toBe(clockLabel(21 * 60));
    expect(storedShowTime('8pm')).toBe(clockLabel(20 * 60));
  });

  it('is kept as typed, minus stray spaces, when no clock time can be read from it', () => {
    expect(storedShowTime('  after the football  ')).toBe('after the football');
    expect(storedShowTime('')).toBe('');
  });
});
