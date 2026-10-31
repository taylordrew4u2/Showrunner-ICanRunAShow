import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShowTimeline } from './ShowTimeline';
import { generateSchedule } from '../utils/generateSchedule';

describe('the shape of the night on a long bill', () => {
  it('tells the strip how many cues it holds, so the blocks can narrow to fit a phone', () => {
    // Twelve pixels a cue ran a 27-cue night past a 375px screen, and the
    // closer and the outro were cut off. The CSS sizes the blocks from this.
    const acts = Array.from({ length: 12 }, (_, i) => ({ performer: { id: `p${i}`, name: `Act ${i + 1}` } }));
    const schedule = generateSchedule({ hostName: 'Hal', acts, intermissionAfter: 6 });
    expect(schedule).toHaveLength(27);
    const html = renderToStaticMarkup(createElement(ShowTimeline, { schedule }));
    expect(html).toContain('<ul class="timeline__strip" style="--cues:27">');
    expect(html.match(/class="timeline__slot"/g)).toHaveLength(27);
  });
});
