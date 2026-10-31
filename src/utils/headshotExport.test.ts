import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Performer } from '../types';

vi.mock('./mediaStore', () => ({
  isMediaRef: (value?: string | null) => !!value && value.startsWith('media:'),
  resolveMediaUrl: vi.fn(),
}));

import { resolveMediaUrl } from './mediaStore';
import {
  chooseDelivery,
  countHeadshots,
  exportNote,
  gatherHeadshots,
  headshotButtonLabel,
  headshotZip,
  imageExtension,
  loadHeadshot,
  nameHeadshotFiles,
  sanitizeFileName,
  singleImageFileName,
  shareFailure,
  shareHeadshots,
  zipFileName,
  type LoadedImage,
} from './headshotExport';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const performer = (name: string, photo?: string, id = name): Performer => ({ id, name, photo });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a name as a file name', () => {
  it('keeps the name exactly as written when nothing in it is a problem', () => {
    expect(sanitizeFileName('Jane Doe')).toBe('Jane Doe');
    expect(sanitizeFileName("D'Angelo O'Brien-Smith, Jr.")).toBe("D'Angelo O'Brien-Smith, Jr.");
  });

  it('keeps accents and emoji', () => {
    expect(sanitizeFileName('Zoë Ångström')).toBe('Zoë Ångström');
    expect(sanitizeFileName('Big Mike 🎤')).toBe('Big Mike 🎤');
    expect(sanitizeFileName('李小龙')).toBe('李小龙');
  });

  it('takes out only what a file system refuses', () => {
    expect(sanitizeFileName('AC/DC')).toBe('AC-DC');
    expect(sanitizeFileName('Tom \\ Jerry | Co')).toBe('Tom - Jerry - Co');
    expect(sanitizeFileName('"Big" Mike: Live? <now>*')).toBe('Big Mike Live now');
  });

  it('turns control characters into spaces and trims', () => {
    expect(sanitizeFileName('  Jane\tDoe\n ')).toBe('Jane Doe');
    expect(sanitizeFileName('Jane\u0000Doe\u007f')).toBe('Jane Doe');
  });

  it('caps a runaway name without cutting an emoji in half', () => {
    const long = `${'x'.repeat(99)}🎤🎤`;
    expect(sanitizeFileName(long)).toBe(`${'x'.repeat(99)}🎤`);
  });

  it('can be left with nothing', () => {
    expect(sanitizeFileName('???')).toBe('');
    expect(sanitizeFileName('   ')).toBe('');
  });
});

describe('one picture saved on its own', () => {
  it('keeps accented and non-Latin letters, the way the zip does', () => {
    expect(singleImageFileName('José', 'headshot', 'jpg')).toBe('José-headshot.jpg');
    expect(singleImageFileName('Zoë', 'headshot', 'png')).toBe('Zoë-headshot.png');
    expect(singleImageFileName('李小龙', 'headshot', 'jpg')).toBe('李小龙-headshot.jpg');
    expect(singleImageFileName('Café Comedy', 'flyer', 'jpg')).toBe('Café Comedy-flyer.jpg');
    expect(singleImageFileName('お笑いナイト', 'flyer', 'webp')).toBe('お笑いナイト-flyer.webp');
  });

  it('takes out only what a file system refuses', () => {
    expect(singleImageFileName('Mona Sable', 'headshot', 'jpg')).toBe('Mona Sable-headshot.jpg');
    expect(singleImageFileName('Laughs @ 8/9', 'flyer', 'png')).toBe('Laughs @ 8-9-flyer.png');
  });

  it('falls back to what it is when nothing of the name is left', () => {
    expect(singleImageFileName('', 'headshot', 'jpg')).toBe('comic-headshot.jpg');
    expect(singleImageFileName('???', 'flyer', 'jpg')).toBe('show-flyer.jpg');
  });
});

describe('the extension a headshot gets', () => {
  it('comes from the image type', () => {
    expect(imageExtension('image/jpeg')).toBe('jpg');
    expect(imageExtension('image/png')).toBe('png');
    expect(imageExtension('image/webp')).toBe('webp');
    expect(imageExtension('image/heic')).toBe('heic');
    expect(imageExtension('image/gif')).toBe('gif');
    expect(imageExtension('IMAGE/PNG; charset=binary')).toBe('png');
  });

  it('comes from the bytes when the server would not say', () => {
    expect(imageExtension('application/octet-stream', PNG)).toBe('png');
    expect(imageExtension('', JPEG)).toBe('jpg');
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
    expect(imageExtension('', webp)).toBe('webp');
    const heic = new TextEncoder().encode('\0\0\0\x18ftypheic\0\0\0\0');
    expect(imageExtension('', heic)).toBe('heic');
  });

  it('falls back to JPEG, which is what every upload is resized to', () => {
    expect(imageExtension('')).toBe('jpg');
    expect(imageExtension('application/octet-stream', Uint8Array.from([1, 2, 3]))).toBe('jpg');
  });
});

describe('naming a run of headshots', () => {
  it('names each file after the act, with the right extension', () => {
    expect(
      nameHeadshotFiles([
        { name: 'Jane Doe', position: 1, type: 'image/jpeg' },
        { name: 'Zoë Ångström', position: 2, type: 'image/png' },
        { name: 'Dev Okonjo', position: 3, type: 'image/heic' },
      ]),
    ).toEqual(['Jane Doe.jpg', 'Zoë Ångström.png', 'Dev Okonjo.heic']);
  });

  it('numbers a name used twice, without regard to case', () => {
    expect(
      nameHeadshotFiles([
        { name: 'Jane Doe', position: 1, type: 'image/jpeg' },
        { name: 'jane doe', position: 2, type: 'image/png' },
        { name: 'Jane Doe ', position: 3, type: 'image/jpeg' },
        { name: 'Jane Doe (2)', position: 4, type: 'image/jpeg' },
      ]),
    ).toEqual(['Jane Doe.jpg', 'jane doe (2).png', 'Jane Doe (3).jpg', 'Jane Doe (2) (2).jpg']);
  });

  it('calls a nameless slot by its place on the bill', () => {
    expect(
      nameHeadshotFiles([
        { name: '', position: 1, type: 'image/jpeg' },
        { name: '???', position: 4, type: 'image/jpeg' },
        { name: 'Performer 1', position: 5, type: 'image/jpeg' },
      ]),
    ).toEqual(['Performer 1.jpg', 'Performer 4.jpg', 'Performer 1 (2).jpg']);
  });

  it('renames an act whose name Windows keeps for a device, so the zip extracts there', () => {
    expect(
      nameHeadshotFiles(['Con', 'Aux', 'nul', 'PRN', 'COM1', 'Lpt3', 'COM¹', 'Aux.Cord', 'con'].map((name, i) => (
        { name, position: i + 1, type: 'image/jpeg' }
      ))),
    ).toEqual([
      'Con (performer).jpg',
      'Aux (performer).jpg',
      'nul (performer).jpg',
      'PRN (performer).jpg',
      'COM1 (performer).jpg',
      'Lpt3 (performer).jpg',
      'COM¹ (performer).jpg',
      // Windows reads everything before the first dot, so "Aux.Cord.jpg" is AUX too.
      'Aux (performer).Cord.jpg',
      'con (performer) (2).jpg',
    ]);
  });

  it('leaves a name that only starts like a device name alone', () => {
    expect(
      nameHeadshotFiles(['Con Artist', 'Console', 'Auxiliary', 'Nul Points', 'COM10', 'LPT'].map((name, i) => (
        { name, position: i + 1, type: 'image/jpeg' }
      ))),
    ).toEqual(['Con Artist.jpg', 'Console.jpg', 'Auxiliary.jpg', 'Nul Points.jpg', 'COM10.jpg', 'LPT.jpg']);
  });

  it('names the zip after the show', () => {
    expect(zipFileName('Late Set')).toBe('Late Set headshots.zip');
    expect(zipFileName('Laughs @ 8/9')).toBe('Laughs @ 8-9 headshots.zip');
    expect(zipFileName('')).toBe('Headshots.zip');
    expect(zipFileName()).toBe('Headshots.zip');
  });

  it('names the zip with surprise guests in it as that, so it is not the one forwarded by mistake', () => {
    expect(zipFileName('Late Set', { includesGuests: true })).toBe('Late Set headshots with surprise guests.zip');
    expect(zipFileName('', { includesGuests: true })).toBe('Headshots with surprise guests.zip');
  });
});

describe('what the button says', () => {
  it('counts the photos it will fetch', () => {
    expect(headshotButtonLabel(6)).toBe('Download 6 headshots');
    expect(headshotButtonLabel(1)).toBe('Download 1 headshot');
  });

  it('says when the download has the surprise guests in it', () => {
    expect(headshotButtonLabel(3, null, { includesGuests: true })).toBe('Download 3 headshots with surprise guests');
    expect(headshotButtonLabel(1, null, { includesGuests: true })).toBe('Download 1 headshot with surprise guests');
    expect(headshotButtonLabel(3, { done: 0, total: 3 }, { includesGuests: true })).toBe('Preparing 1 of 3…');
  });

  it('counts through them while it works', () => {
    expect(headshotButtonLabel(6, { done: 0, total: 6 })).toBe('Preparing 1 of 6…');
    expect(headshotButtonLabel(6, { done: 2, total: 6 })).toBe('Preparing 3 of 6…');
    expect(headshotButtonLabel(6, { done: 6, total: 6 })).toBe('Preparing 6 of 6…');
  });

  it('only counts performers who have a photo', () => {
    expect(countHeadshots([performer('A', 'media:a#1'), performer('B'), performer('C', '  ')])).toBe(1);
  });
});

describe('share sheet or zip', () => {
  const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const iPadDesktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

  it('opens the share sheet on an iPhone, so the photos can go straight to Photos', () => {
    expect(chooseDelivery({ userAgent: iPhone, maxTouchPoints: 5, canShareFiles: true })).toBe('share');
  });

  it('knows an iPad asking for the desktop site by its touch screen', () => {
    expect(chooseDelivery({ userAgent: iPadDesktop, maxTouchPoints: 5, canShareFiles: true })).toBe('share');
    expect(chooseDelivery({ userAgent: iPadDesktop, maxTouchPoints: 0, canShareFiles: true })).toBe('zip');
  });

  it('falls back to the zip on an iPhone that cannot share files', () => {
    expect(chooseDelivery({ userAgent: iPhone, maxTouchPoints: 5, canShareFiles: false })).toBe('zip');
  });

  it('gives Android and desktop browsers one zip, even where they could share', () => {
    expect(chooseDelivery({ userAgent: android, maxTouchPoints: 5, canShareFiles: true })).toBe('zip');
    expect(chooseDelivery({ userAgent: windows, maxTouchPoints: 0, canShareFiles: true })).toBe('zip');
  });

  it('reads a refused share for what it means', () => {
    expect(shareFailure(new DOMException('closed', 'AbortError'))).toBe('cancelled');
    expect(shareFailure(new DOMException('no gesture', 'NotAllowedError'))).toBe('needs-tap');
    expect(shareFailure(new TypeError('bad data'))).toBe('failed');
    expect(shareFailure(null)).toBe('failed');
  });

  it('shares nothing but the files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    const files = [new File([JPEG], 'Jane Doe.jpg', { type: 'image/jpeg' })];
    expect(await shareHeadshots(files)).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files });
  });

  it('reports a stale tap so the photos can wait for a fresh one', async () => {
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new DOMException('', 'NotAllowedError')) });
    expect(await shareHeadshots([])).toBe('needs-tap');
  });
});

describe('fetching every headshot on the bill', () => {
  const image = (bytes: Uint8Array, type = 'image/jpeg'): LoadedImage => ({ bytes, type });

  it('keeps running order and names each file after the act', async () => {
    const photos: Record<string, LoadedImage> = {
      'media:a#1': image(JPEG),
      'media:b#1': image(PNG, 'image/png'),
    };
    const result = await gatherHeadshots(
      [performer('Jane Doe', 'media:a#1'), performer('No Photo'), performer('Dev Okonjo', 'media:b#1')],
      async (photo) => photos[photo] ?? null,
    );
    expect(result.missing).toEqual([]);
    expect(result.files.map((f) => [f.performer, f.fileName, f.type])).toEqual([
      ['Jane Doe', 'Jane Doe.jpg', 'image/jpeg'],
      ['Dev Okonjo', 'Dev Okonjo.png', 'image/png'],
    ]);
    expect(result.files[0].bytes).toBe(photos['media:a#1'].bytes);
  });

  it('delivers what loaded and names who did not', async () => {
    const result = await gatherHeadshots(
      [
        performer('Jane Doe', 'media:ok#1'),
        performer('Offline Ollie', 'media:gone#1'),
        performer('Broken Link', 'https://example.com/404.jpg'),
        performer('Web Page', 'https://example.com/page'),
        performer('', 'media:empty#1'),
        performer('Dev Okonjo', 'media:ok2#1'),
      ],
      async (photo) => {
        if (photo === 'media:ok#1' || photo === 'media:ok2#1') return image(JPEG);
        if (photo === 'media:gone#1') return null;
        if (photo.endsWith('404.jpg')) throw new Error('offline');
        if (photo.endsWith('page')) return image(new TextEncoder().encode('<html>'), 'text/html');
        return image(new Uint8Array());
      },
    );
    expect(result.files.map((f) => f.fileName)).toEqual(['Jane Doe.jpg', 'Dev Okonjo.jpg']);
    expect(result.missing).toEqual(['Offline Ollie', 'Broken Link', 'Web Page', 'Performer 5']);
  });

  it('gives a file the server mislabelled an image type it can be saved as', async () => {
    const result = await gatherHeadshots([performer('Jane Doe', 'https://cdn.example/jane')], async () =>
      image(PNG, 'application/octet-stream'),
    );
    expect(result.files[0]).toMatchObject({ fileName: 'Jane Doe.png', type: 'image/png' });
  });

  it('numbers two acts with the same name only among the photos that arrived', async () => {
    const result = await gatherHeadshots(
      [performer('Sam', 'media:x#1', '1'), performer('Sam', 'media:y#1', '2'), performer('Sam', 'media:z#1', '3')],
      async (photo) => (photo === 'media:x#1' ? null : image(JPEG)),
    );
    expect(result.files.map((f) => f.fileName)).toEqual(['Sam.jpg', 'Sam (2).jpg']);
    expect(result.missing).toEqual(['Sam']);
  });

  it('fetches a few at a time and reports progress as each one lands', async () => {
    let inFlight = 0;
    let most = 0;
    const progress: [number, number][] = [];
    const bill = Array.from({ length: 7 }, (_, i) => performer(`Act ${i + 1}`, `media:${i}#1`));
    const result = await gatherHeadshots(
      bill,
      async () => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        return image(JPEG);
      },
      { concurrency: 3, onProgress: (done, total) => progress.push([done, total]) },
    );
    expect(result.files).toHaveLength(7);
    expect(most).toBe(3);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7].map((done) => [done, 7]));
  });

  it('has nothing to do for a bill without photos', async () => {
    const load = vi.fn();
    expect(await gatherHeadshots([performer('A'), performer('B')], load)).toEqual({ files: [], missing: [] });
    expect(load).not.toHaveBeenCalled();
  });
});

describe('loading one headshot the way the app shows it', () => {
  beforeEach(() => vi.mocked(resolveMediaUrl).mockReset());

  it('resolves a media reference through the media store', async () => {
    vi.mocked(resolveMediaUrl).mockResolvedValue(PNG_DATA_URL);
    const loaded = await loadHeadshot('media:abc#1');
    expect(resolveMediaUrl).toHaveBeenCalledWith('media:abc#1');
    expect(loaded?.type).toBe('image/png');
    expect([...loaded!.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('has nothing when the media store cannot fetch it', async () => {
    vi.mocked(resolveMediaUrl).mockResolvedValue(null);
    expect(await loadHeadshot('media:abc#1')).toBeNull();
  });

  it('decodes an older data URL in place, without fetching it', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const loaded = await loadHeadshot(PNG_DATA_URL);
    expect(loaded?.type).toBe('image/png');
    expect(fetch).not.toHaveBeenCalled();
    expect(resolveMediaUrl).not.toHaveBeenCalled();
  });

  it('fetches a plain link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Blob([JPEG], { type: 'image/jpeg' }))));
    const loaded = await loadHeadshot('https://example.com/jane.jpg');
    expect(loaded?.type).toBe('image/jpeg');
    expect([...loaded!.bytes]).toEqual([...JPEG]);
  });

  it('has nothing for a link that answers with an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', { status: 404 })));
    expect(await loadHeadshot('https://example.com/jane.jpg')).toBeNull();
  });
});

describe('telling the producer what came through', () => {
  it('says nothing when every photo arrived', () => {
    expect(exportNote(4, [])).toBeNull();
  });

  it('names whoever is missing from a download that went ahead', () => {
    expect(exportNote(3, ['Jane Doe'])).toEqual({
      tone: 'status',
      text: "Jane Doe isn't included: their headshot wouldn't load. Check your connection and try again.",
    });
    expect(exportNote(1, ['Jane Doe', 'Bo', 'Cal'])?.text).toBe(
      "Jane Doe, Bo and Cal aren't included: their headshots wouldn't load. Check your connection and try again.",
    );
  });

  it('says plainly that nothing was downloaded when nothing loaded', () => {
    expect(exportNote(0, ['Jane Doe'])).toEqual({
      tone: 'alert',
      text: "Jane Doe's headshot wouldn't load, so nothing was downloaded. Check your connection and try again.",
    });
    expect(exportNote(0, ['A', 'B'])?.text).toBe(
      'None of the 2 headshots would load, so nothing was downloaded. Check your connection and try again.',
    );
  });
});

describe('handing over the zip', () => {
  it('packs every file under its own name', async () => {
    const zip = headshotZip([
      { performer: 'Jane Doe', fileName: 'Jane Doe.jpg', type: 'image/jpeg', bytes: JPEG },
      { performer: 'Zoë', fileName: 'Zoë.png', type: 'image/png', bytes: PNG },
    ]);
    expect(zip.type).toBe('application/zip');
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(bytes.length - 22 + 10, true)).toBe(2);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Jane Doe.jpg');
    expect(text).toContain('Zoë.png');
  });
});
