import { describe, expect, it } from 'vitest';
import { photoFailureMessage, photoProblem } from './photoProblem';

describe('a headshot that will not go in', () => {
  it('names the iPhone format problem and gives the screenshot fix', () => {
    const msg = photoProblem({ name: 'IMG_4021.HEIC', type: 'image/heic', size: 2_000_000 });
    expect(msg).toContain('HEIC');
    expect(msg).toContain('screenshot');
    expect(msg).toContain('Most Compatible');
  });

  it('catches a HEIC the phone handed over with no type at all', () => {
    expect(photoProblem({ name: 'IMG_4021.heic', type: '', size: 10 })).toContain('screenshot');
  });

  it('says a file still syncing from the cloud is not broken, just early', () => {
    const msg = photoProblem({ name: 'IMG_1.jpg', type: 'image/jpeg', size: 0 });
    expect(msg).toContain('iCloud');
    expect(msg).toContain('again');
  });

  it('tells someone who picked a PDF what to pick instead', () => {
    const msg = photoProblem({ name: 'headshot.pdf', type: 'application/pdf', size: 900 });
    expect(msg).toContain('pdf');
    expect(msg).toContain('JPEG');
  });

  it('has nothing to say about an ordinary photo', () => {
    expect(photoProblem({ name: 'me.jpg', type: 'image/jpeg', size: 400_000 })).toBeNull();
  });

  it('always leaves the person something to try, even with nothing to go on', () => {
    const msg = photoFailureMessage();
    expect(msg).toContain('screenshot');
    // Never a dead end: the last sentence has to offer another move.
    expect(msg).toMatch(/smaller photo|different one/);
  });

  it('prefers the specific reason over the general one when it knows it', () => {
    expect(photoFailureMessage({ name: 'x.heic', type: 'image/heic', size: 5 })).toContain('HEIC');
  });
});
