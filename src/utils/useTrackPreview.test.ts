import { describe, expect, it } from 'vitest';
import { previewTakenOver } from './useTrackPreview';

const WALK_ON = 'media:walk-on';
const OTHER = 'media:other-song';

describe('the play button on an uploaded track while it loads', () => {
  it('keeps saying Stop while the engine is still fetching and decoding the track', () => {
    // The engine has nothing playing yet — the decode is still running.
    expect(previewTakenOver(WALK_ON, WALK_ON, null)).toBe(false);
  });

  it('keeps saying Stop once the track has started', () => {
    expect(previewTakenOver(WALK_ON, null, WALK_ON)).toBe(false);
  });

  it('goes back to Play when another row or the soundboard takes the engine', () => {
    expect(previewTakenOver(WALK_ON, null, OTHER)).toBe(true);
  });

  it('goes back to Play when the track has stopped and nothing is loading', () => {
    expect(previewTakenOver(WALK_ON, null, null)).toBe(true);
  });

  it('gives the button up when a different track is the one loading now', () => {
    // The producer pressed another row before this one finished loading.
    expect(previewTakenOver(WALK_ON, OTHER, null)).toBe(true);
  });
});
