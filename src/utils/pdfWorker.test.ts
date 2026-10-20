import { beforeEach, describe, expect, it, vi } from 'vitest';

// pdf.js starts a worker thread for every document it opens, and only
// destroying the document ends it. Each PDF read here has to let its worker go,
// or every import and every contract opened leaves one running, holding its
// copy of the file, until the tab is closed.
const destroy = vi.fn(async () => undefined);
let pages: Array<() => Promise<unknown>> = [];
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({ numPages: pages.length, getPage: (n: number) => pages[n - 1]() }),
    destroy,
  }),
}));

import { importScheduleFromFile } from './aiExtractor';
import { renderPdfPages } from './pdfPages';

const textPage = (str: string) => async () => ({
  getTextContent: async () => ({ items: [{ str, hasEOL: true, transform: [1, 0, 0, 1, 40, 700] }] }),
});
const brokenPage = () => Promise.reject(new Error('damaged page'));
const pdfFile = () => new File(['%PDF-1.4'], 'run-sheet.pdf', { type: 'application/pdf' });
const pdfDataUrl = `data:application/pdf;base64,${btoa('%PDF-1.4')}`;

beforeEach(() => {
  destroy.mockClear();
  pages = [];
});

describe('letting go of the pdf.js worker once a PDF has been read', () => {
  it('closes the document after importing a schedule from it', async () => {
    pages = [textPage('8:00 PM Welcome')];
    const items = await importScheduleFromFile(pdfFile());
    expect(items.map((i) => i.description)).toEqual(['Welcome']);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('closes the document when a page cannot be read, too', async () => {
    pages = [brokenPage];
    await expect(importScheduleFromFile(pdfFile())).rejects.toThrow('damaged page');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('closes a contract once its pages are drawn, and when drawing fails', async () => {
    await expect(renderPdfPages(pdfDataUrl)).resolves.toEqual([]);
    expect(destroy).toHaveBeenCalledTimes(1);

    pages = [brokenPage];
    await expect(renderPdfPages(pdfDataUrl)).rejects.toThrow('damaged page');
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});
