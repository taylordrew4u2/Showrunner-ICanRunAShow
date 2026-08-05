import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveDurationMin, importScheduleFromFile, parseScheduleManually } from './aiExtractor';

describe('parseScheduleManually', () => {
  it('extracts time + description from each line', () => {
    const items = parseScheduleManually('7:00 PM Doors open\n7:30 PM Host intro\n8:00 PM Headliner');
    expect(items.map((i) => [i.time, i.description])).toEqual([
      ['7:00 PM', 'Doors open'],
      ['7:30 PM', 'Host intro'],
      ['8:00 PM', 'Headliner'],
    ]);
  });

  it('handles ranges by dropping the range-end time', () => {
    const items = parseScheduleManually('8:00–8:20 PM Devon');
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe('Devon');
  });

  it('keeps the length a range states instead of discarding it', () => {
    // The range end is the one place a plain-text schedule says how long a
    // segment runs. It used to be stripped and thrown away, so every imported
    // cue arrived with no minutes on it.
    const items = parseScheduleManually('8:00–8:20 PM Devon');
    expect(items[0].durationMin).toBe(20);
  });

  it('reads a stated duration out of the description', () => {
    const items = parseScheduleManually('9:00 PM Intermission (15 min)');
    expect(items[0].durationMin).toBe(15);
  });

  it('leaves a row with no stated length undefined', () => {
    // Not zero, and not a guess: undefined is what lets baseDurations go on
    // inferring the length from the gap to the next cue.
    const items = parseScheduleManually('7:00 PM Doors open\n7:30 PM Host intro');
    expect(items[0].durationMin).toBeUndefined();
  });

  it('reads a range that crosses midnight', () => {
    const items = parseScheduleManually('11:40 PM - 12:10 AM Late set');
    expect(items[0].durationMin).toBe(30);
  });

  it('strips leading bullets and separators', () => {
    const items = parseScheduleManually('• 9:00 PM — Closing set');
    expect(items[0].description).toBe('Closing set');
  });

  it('skips lines without a time', () => {
    expect(parseScheduleManually('Just a note\nAnother line')).toEqual([]);
  });

  it('keeps a description that merely starts with a number', () => {
    const items = parseScheduleManually('7:00 PM 5 min break');
    expect(items[0].description).toBe('5 min break');
  });
});


describe('deriveDurationMin', () => {
  it('takes what the model returned when it is a usable number', () => {
    expect(deriveDurationMin(15, 'Opening set')).toBe(15);
    expect(deriveDurationMin('20', 'Opening set')).toBe(20);
    expect(deriveDurationMin(12.4, 'Opening set')).toBe(12);
  });

  it('refuses a number that cannot be a cue length', () => {
    // A bad length is worse than none — it silently reshapes the running order.
    for (const bad of [0, -5, NaN, Infinity, 'soon', null, undefined, 60 * 24]) {
      expect(deriveDurationMin(bad, 'Opening set')).toBeUndefined();
    }
  });

  it('falls back to the range, then to the text', () => {
    expect(deriveDurationMin(undefined, 'Devon', '8:20 PM', '8:00 PM')).toBe(20);
    expect(deriveDurationMin(undefined, 'Intermission 15 min')).toBe(15);
  });

  it('prefers what the model said over what it can work out', () => {
    expect(deriveDurationMin(10, 'Devon', '8:20 PM', '8:00 PM')).toBe(10);
  });

  it('rounds a sub-minute length up to a minute rather than to nothing', () => {
    expect(deriveDurationMin(undefined, 'Sting 20 sec')).toBe(1);
  });
});

describe('importScheduleFromFile via the AI proxy', () => {
  function mockProxy(items: unknown[]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ items }),
    } as Response));
  }
  afterEach(() => vi.restoreAllMocks());

  const textFile = (body: string) =>
    new File([body], 'schedule.txt', { type: 'text/plain' });

  it('keeps the length the model reports', async () => {
    mockProxy([{ time: '8:00 PM', description: 'Opening set', performer: 'Maya', durationMin: 15 }]);
    const items = await importScheduleFromFile(textFile('8:00 PM Maya opening set'));
    expect(items[0].durationMin).toBe(15);
    expect(items[0].performer).toBe('Maya');
  });

  it('works out the length when the model puts a range in the time field', async () => {
    mockProxy([{ time: '8:00–8:20 PM', description: 'Devon' }]);
    const items = await importScheduleFromFile(textFile('8:00-8:20 PM Devon'));
    expect(items[0].time).toBe('8:00 pm');
    expect(items[0].durationMin).toBe(20);
  });

  it('drops a length the model could not have meant', async () => {
    mockProxy([{ time: '8:00 PM', description: 'Set', durationMin: -3 }]);
    const items = await importScheduleFromFile(textFile('8:00 PM Set'));
    expect(items[0].durationMin).toBeUndefined();
  });
});
