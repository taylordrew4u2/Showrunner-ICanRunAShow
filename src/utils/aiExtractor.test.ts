import { describe, expect, it } from 'vitest';
import { deriveDurationMin, importScheduleFromFile, linesFromPdfText, parseScheduleManually, splitPerformer } from './aiExtractor';

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

  it('puts the name before the dash on stage and keeps the rest as the segment', () => {
    const items = parseScheduleManually('8:35 PM Marisol — headliner\n8:05 PM Devon Park: opening set\n8:20 PM June Ito | closer');
    expect(items.map((i) => [i.performer, i.description])).toEqual([
      ['Marisol', 'headliner'],
      ['Devon Park', 'opening set'],
      ['June Ito', 'closer'],
    ]);
  });

  it('does not mistake a segment with a separator in it for a person', () => {
    const items = parseScheduleManually('8:55 PM Intermission / DJ\n7:30 PM Doors — bar opens\n9:00 PM the band - second set');
    expect(items.map((i) => i.performer)).toEqual([undefined, undefined, undefined]);
    expect(items[1].description).toBe('Doors — bar opens');
  });

  it('starts a range whose first hour has no am/pm at the start, not the end', () => {
    // "8-8:20pm" writes the meridiem once; the cue starts at 8, not 8:20, and
    // the "8-" is part of the time, not the name of the act.
    const items = parseScheduleManually('8-8:20pm Devon\nDoors 7-7:30 PM');
    expect(items.map((i) => [i.time, i.description, i.durationMin])).toEqual([
      ['8 pm', 'Devon', 20],
      ['7 pm', 'Doors', 30],
    ]);
  });

  it('still takes the first time on a line when a range comes later', () => {
    const items = parseScheduleManually('7:00 PM Doors, bar 5-6 pm');
    expect(items[0].time).toBe('7:00 PM');
  });

  it('does not read a row, set or day number before a dash as the start of a range', () => {
    // Read as a range, "1 - 8:00 PM" started at one in the afternoon and ran
    // seven hours — a length the review screen never shows.
    const items = parseScheduleManually(
      '1 - 8:00 PM Doors\nSet 2 - 9:30 PM Devon\nAct 3 – 9:15 PM Jane\nFeb 12 - 8pm Show',
    );
    expect(items.map((i) => [i.time, i.durationMin])).toEqual([
      ['8:00 PM', undefined],
      ['9:30 PM', undefined],
      ['9:15 PM', undefined],
      ['8pm', undefined],
    ]);
  });

  it('still reads a range that runs a whole evening', () => {
    expect(parseScheduleManually('Doors 7-10pm').map((i) => [i.time, i.durationMin])).toEqual([['7 pm', 180]]);
  });

  it('keeps the am/pm of a range end that a colon or comma follows', () => {
    // The stray "PM" used to become the cue's performer, and the length was lost.
    const items = parseScheduleManually(
      '8:00 PM - 8:20 PM: Ada Cole\n8:00 PM to 8:20 PM: Ada Cole\n9 PM - 9:20 PM: Devon\n8:00 PM – 8:20 PM, Ada Cole',
    );
    expect(items.map((i) => [i.performer, i.description, i.durationMin])).toEqual([
      [undefined, 'Ada Cole', 20],
      [undefined, 'Ada Cole', 20],
      [undefined, 'Devon', 20],
      [undefined, 'Ada Cole', 20],
    ]);
  });

  it('never takes am or pm for a performer', () => {
    expect(splitPerformer('PM: Ada Cole').performer).toBeUndefined();
    expect(splitPerformer('P.M. — Ada Cole').performer).toBeUndefined();
  });

  it('reads a time written with a dot, as UK and Australian run sheets do', () => {
    // "8.00pm" used to be read as "00pm" — noon — and "7.30pm" as no time at all.
    const items = parseScheduleManually('7.30pm Doors\n8.00pm Welcome\n8.05 p.m. Devon');
    expect(items.map((i) => [i.time, i.description])).toEqual([
      ['7:30pm', 'Doors'],
      ['8:00pm', 'Welcome'],
      ['8:05 pm', 'Devon'],
    ]);
  });

  it('reads a dotted range and its length', () => {
    const items = parseScheduleManually('8.00-8.20pm Devon\n9.00pm - 9.15pm Raffle');
    expect(items.map((i) => [i.time, i.description, i.durationMin])).toEqual([
      ['8:00 pm', 'Devon', 20],
      ['9:00pm', 'Raffle', 15],
    ]);
  });

  it('does not read a price as a time', () => {
    expect(parseScheduleManually('Tickets £7.50 on the door')).toEqual([]);
  });
});

describe('parseScheduleManually on rows pasted from a spreadsheet', () => {
  it('reads the performer out of its own column, whichever side of the segment it is on', () => {
    const items = parseScheduleManually('8:00 PM\tWelcome\tAda Cole\n8:10 PM\tDevon Park\tOpening set');
    expect(items.map((i) => [i.time, i.performer, i.description])).toEqual([
      ['8:00 PM', 'Ada Cole', 'Welcome'],
      ['8:10 PM', 'Devon Park', 'Opening set'],
    ]);
  });

  it('reads a start and an end column as a range with a length', () => {
    const items = parseScheduleManually('8:00 PM\t8:20 PM\tDevon\nJune Ito\t8:20 PM\t8:35 PM');
    expect(items.map((i) => [i.time, i.description, i.durationMin])).toEqual([
      ['8:00 PM', 'Devon', 20],
      ['8:20 PM', 'June Ito', 15],
    ]);
  });

  it('does not guess a performer when two columns could both be names', () => {
    const items = parseScheduleManually('8:00 PM\tComedy\tAda Cole');
    expect(items[0].performer).toBeUndefined();
    expect(items[0].description).not.toMatch(/\t/);
  });

  it('keeps a column that holds a name and its segment together', () => {
    const items = parseScheduleManually('8:35 PM\tMarisol — headliner');
    expect(items.map((i) => [i.performer, i.description])).toEqual([['Marisol', 'headliner']]);
  });

  it('skips the header row', () => {
    expect(parseScheduleManually('Time\tSegment\tPerformer\n8:00 PM\tWelcome\tAda Cole')).toHaveLength(1);
  });
});

describe('linesFromPdfText', () => {
  const row = (str: string, y: number, hasEOL = true) => ({ str, hasEOL, transform: [1, 0, 0, 1, 40, y] });

  it('keeps each row of a PDF run sheet on its own line', () => {
    // pdf.js hands back one item per row with hasEOL set; flattening them into
    // one line made the parser see a single cue whose text was the whole page.
    const text = linesFromPdfText([row('Doors 7:30 PM', 700), row('8:00 PM Maya welcome', 680), row('8:05 PM Devon Park', 660)]);
    expect(parseScheduleManually(text).map((i) => i.time)).toEqual(['7:30 PM', '8:00 PM', '8:05 PM']);
  });

  it('breaks the line when the text moves down the page even without an end-of-line flag', () => {
    const text = linesFromPdfText([row('8:00 PM', 700, false), row('Maya welcome', 700, false), row('8:05 PM Devon Park', 680, false)]);
    expect(text).toBe('8:00 PM Maya welcome\n8:05 PM Devon Park');
  });

  it('ignores marked-content markers that carry no text', () => {
    const text = linesFromPdfText([{ type: 'beginMarkedContent' }, row('8:00 PM Maya', 700), { type: 'endMarkedContent' }]);
    expect(text).toBe('8:00 PM Maya');
  });
});

describe('splitPerformer', () => {
  it('needs both a name-shaped left side and a segment on the right', () => {
    expect(splitPerformer('Maya —')).toEqual({ description: 'Maya —' });
    expect(splitPerformer('A very long list of words here: set')).toEqual({ description: 'A very long list of words here: set' });
    expect(splitPerformer("D'Angelo O’Neil-Smith: closer")).toEqual({ performer: "D'Angelo O’Neil-Smith", description: 'closer' });
  });
});


describe('deriveDurationMin', () => {
  it('takes a stated length when it is a usable number', () => {
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

  it('prefers a stated length over one it can work out', () => {
    expect(deriveDurationMin(10, 'Devon', '8:20 PM', '8:00 PM')).toBe(10);
  });

  it('rounds a sub-minute length up to a minute rather than to nothing', () => {
    expect(deriveDurationMin(undefined, 'Sting 20 sec')).toBe(1);
  });
});

describe('importScheduleFromFile', () => {
  const textFile = (body: string) =>
    new File([body], 'schedule.txt', { type: 'text/plain' });

  it('reads a text file on this device, with no request to anyone', async () => {
    const items = await importScheduleFromFile(textFile('8:00-8:20 PM Devon\n8:35 PM Marisol — headliner (15 min)'));
    expect(items.map((i) => [i.time, i.performer, i.description, i.durationMin])).toEqual([
      ['8:00 pm', undefined, 'Devon', 20],
      ['8:35 PM', 'Marisol', 'headliner (15 min)', 15],
    ]);
  });

  it('says so when a file has no schedule in it', async () => {
    await expect(importScheduleFromFile(textFile('Just notes\nNo times here'))).rejects.toThrow(/No schedule lines/);
  });
});
