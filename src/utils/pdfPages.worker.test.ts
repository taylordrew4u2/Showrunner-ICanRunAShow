import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importScheduleFromFile } from './aiExtractor';
import { renderPdfPages, ScanNeedsWebAssemblyError } from './pdfPages';

// Every pdf.js document is opened with a Web Worker of its own, holding a
// parsed copy of the file, and only destroying the loading task lets the two
// go. A signer who taps Try again, or a producer importing a few run sheets,
// was leaving one behind each time.
const pdfjs = vi.hoisted(() => ({
  destroy: vi.fn(async () => {}),
  getPage: vi.fn(),
  numPages: 2,
  // What the document was opened with, for the decoder pdf.js asks for.
  options: null as null | { WasmFactory: new (options: { baseUrl: null }) => { fetch(request: { filename: string }): Promise<Uint8Array> } },
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: (options: typeof pdfjs.options) => {
    pdfjs.options = options;
    return {
      promise: Promise.resolve({ numPages: pdfjs.numPages, getPage: pdfjs.getPage }),
      destroy: pdfjs.destroy,
    };
  },
}));

const pdfDataUrl = `data:application/pdf;base64,${btoa('%PDF-1.4')}`;

const drawablePage = () => ({
  getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale }),
  render: () => ({ promise: Promise.resolve() }),
  getTextContent: async () => ({ items: [{ str: '8:00 PM Doors', hasEOL: true, transform: [0, 0, 0, 0, 0, 700] }] }),
});

beforeEach(() => {
  pdfjs.destroy.mockClear();
  pdfjs.getPage.mockReset();
  pdfjs.numPages = 2;
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect: () => {} }),
      toDataURL: () => 'data:image/jpeg;base64,AA',
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('letting go of a contract once it is drawn', () => {
  it('destroys the document after the last page', async () => {
    pdfjs.getPage.mockImplementation(async () => drawablePage());

    const pages = await renderPdfPages(pdfDataUrl);

    expect(pages).toHaveLength(2);
    expect(pdfjs.destroy).toHaveBeenCalledOnce();
  });

  it('destroys it too when a page will not draw', async () => {
    pdfjs.getPage
      .mockImplementationOnce(async () => drawablePage())
      .mockRejectedValueOnce(new Error('bad page'));

    await expect(renderPdfPages(pdfDataUrl)).rejects.toThrow('bad page');
    expect(pdfjs.destroy).toHaveBeenCalledOnce();
  });
});

describe('a scanned contract where WebAssembly cannot run', () => {
  /** A page with a JPEG 2000 scan on it: drawing it asks for the decoder, and pdf.js swallows a refusal. */
  const scannedPage = () => ({
    ...drawablePage(),
    render: () => ({
      promise: new pdfjs.options!.WasmFactory({ baseUrl: null }).fetch({ filename: 'openjpeg.wasm' }).then(() => {}, () => {}),
    }),
  });

  it('refuses to show the page, rather than show it without its scan', async () => {
    // iOS 15 under the site's CSP. pdf.js drew the page without its image,
    // and the signer was asked to agree to white paper.
    vi.stubGlobal('WebAssembly', {
      Module: class {
        constructor() {
          throw new EvalError("Refused to create a WebAssembly object because 'unsafe-eval' is not an allowed source of script");
        }
      },
    });
    pdfjs.getPage.mockImplementation(async () => scannedPage());
    const shown: number[] = [];

    await expect(renderPdfPages(pdfDataUrl, (page) => shown.push(page.pageNumber))).rejects.toBeInstanceOf(ScanNeedsWebAssemblyError);
    expect(shown).toEqual([]);
    expect(pdfjs.destroy).toHaveBeenCalledOnce();
  });

  it('draws a page with no scan on it as before', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    pdfjs.getPage.mockImplementation(async () => drawablePage());
    await expect(renderPdfPages(pdfDataUrl)).resolves.toHaveLength(2);
  });

  it('draws a scanned page where WebAssembly runs', async () => {
    pdfjs.getPage.mockImplementation(async () => scannedPage());
    await expect(renderPdfPages(pdfDataUrl)).resolves.toHaveLength(2);
  });
});

describe('letting go of an imported run sheet once it is read', () => {
  it('destroys the document after reading its text', async () => {
    pdfjs.numPages = 1;
    pdfjs.getPage.mockImplementation(async () => drawablePage());

    const items = await importScheduleFromFile(new File(['%PDF-1.4'], 'sheet.pdf', { type: 'application/pdf' }));

    expect(items.map((i) => i.description)).toEqual(['Doors']);
    expect(pdfjs.destroy).toHaveBeenCalledOnce();
  });
});
