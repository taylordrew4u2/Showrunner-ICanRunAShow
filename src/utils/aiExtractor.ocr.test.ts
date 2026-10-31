import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The photo reader (tesseract.js) fetches its worker, engine and language
// data the first time it runs. Offline, or on a venue network that blocks
// the download, it never starts — and that is not the photo's fault.
const recognize = vi.fn();
vi.mock('tesseract.js', () => ({ recognize: (...a: unknown[]) => recognize(...a) }));

import { importScheduleFromFile } from './aiExtractor';

const photo = () => new File([new Uint8Array([0xff, 0xd8])], 'run-sheet.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  recognize.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reading a schedule off a photo', () => {
  it('says the photo reader needs a connection when it cannot load, not that the photo is unclear', async () => {
    recognize.mockRejectedValue(new Error("NetworkError: Failed to execute 'importScripts'"));
    const reading = importScheduleFromFile(photo());
    await expect(reading).rejects.toThrow(/connection/);
    await expect(reading).rejects.not.toThrow(/clearly visible/);
  });

  it('says this browser cannot run the reader, not that it needs a connection, when WebAssembly is refused', async () => {
    // iOS 15 refuses WebAssembly under the site's CSP: WebKit learned
    // 'wasm-unsafe-eval' only in 16.0. A connection would change nothing.
    recognize.mockRejectedValue(new Error('RuntimeError: Aborted(CompileError)'));
    vi.stubGlobal('WebAssembly', {
      Module: class {
        constructor() {
          throw new EvalError("Refused to create a WebAssembly object because 'unsafe-eval' is not an allowed source of script");
        }
      },
    });
    const reading = importScheduleFromFile(photo());
    await expect(reading).rejects.toThrow(/iOS 16/);
    await expect(reading).rejects.not.toThrow(/connection|signal/);
  });

  it('says the same where there is no WebAssembly at all', async () => {
    // Lockdown Mode turns it off.
    recognize.mockRejectedValue(new Error('WebAssembly is not defined'));
    vi.stubGlobal('WebAssembly', undefined);
    await expect(importScheduleFromFile(photo())).rejects.toThrow(/Lockdown Mode/);
  });

  it('blames the photo, not the connection, when the reader ran but could not open the file', async () => {
    // tesseract.js rejects with the worker's error as a string, not an Error.
    recognize.mockRejectedValue('Error: Error attempting to read image.');
    const reading = importScheduleFromFile(photo());
    await expect(reading).rejects.toThrow(/that photo/);
    await expect(reading).rejects.not.toThrow(/connection/);
  });

  it('still asks for a clearer photo when the reader ran and found no times', async () => {
    recognize.mockResolvedValue({ data: { text: 'a blurry whiteboard' } });
    await expect(importScheduleFromFile(photo())).rejects.toThrow(/clearly visible/);
  });

  it('reads the cues the photo reader found', async () => {
    recognize.mockResolvedValue({ data: { text: '8:00 PM Welcome\n8:10 PM Devon' } });
    const items = await importScheduleFromFile(photo());
    expect(items.map((i) => i.description)).toEqual(['Welcome', 'Devon']);
  });
});
