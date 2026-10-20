import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The real file, which is what Xcode builds the App Store app from.
const plist = readFileSync(new URL('../../ios/App/App/Info.plist', import.meta.url), 'utf8');

/** The string a key is set to, or null when the key is not there. */
function stringFor(key: string): string | null {
  const match = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match ? match[1].trim() : null;
}

describe('what the iOS app tells people before it uses the camera or their photos', () => {
  // Headshots, flyers and schedule import all take a picture through a file
  // input that accepts images. In the native app, WKWebView offers "Take
  // Photo" for those, and iOS kills an app that opens the camera without a
  // usage string here: the producer tapped a button and the app vanished.
  it('says why it wants the camera', () => {
    expect(stringFor('NSCameraUsageDescription')).toBeTruthy();
  });

  it('says why it wants a photo from the library', () => {
    expect(stringFor('NSPhotoLibraryUsageDescription')).toBeTruthy();
  });

  it('says why it would save a picture to the library', () => {
    // Pressing and holding a flyer or headshot offers "Save to Photos", and the
    // share sheet offers "Save Image". Saving needs its own usage string; iOS
    // kills the app without one. In the app that is the only way to keep a
    // flyer: Capacitor hands the Download button's blob link to iOS as an
    // outside address, and nothing opens it.
    expect(stringFor('NSPhotoLibraryAddUsageDescription')).toBeTruthy();
  });
});
