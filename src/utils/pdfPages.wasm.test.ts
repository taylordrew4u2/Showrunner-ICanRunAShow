import { describe, it, expect } from 'vitest';
import { BundledWasmFactory, fetchBundledWasm } from './pdfPages';

const ok = (bytes: number[]) => async () => new Response(new Uint8Array(bytes));

describe('the decoders a scanned contract needs', () => {
  it('hands pdf.js its JPEG 2000 decoder from the app itself, so a scanned page is not left blank', async () => {
    const asked: string[] = [];
    const bytes = await fetchBundledWasm('openjpeg.wasm', async (url) => {
      asked.push(url.pathname);
      return new Response(new Uint8Array([0, 0x61, 0x73, 0x6d]));
    });
    expect(asked).toHaveLength(1);
    expect(asked[0].endsWith('/openjpeg.wasm')).toBe(true);
    expect(Array.from(bytes)).toEqual([0, 0x61, 0x73, 0x6d]);
  });

  it('carries the JBIG2 decoder too, the other way a scanner compresses a page', async () => {
    const asked: string[] = [];
    await fetchBundledWasm('jbig2.wasm', async (url) => {
      asked.push(url.pathname);
      return new Response(new Uint8Array([1]));
    });
    expect(asked[0].endsWith('/jbig2.wasm')).toBe(true);
  });

  it('refuses a file the app does not carry rather than fetching whatever the name resolves to', async () => {
    let fetched = false;
    await expect(
      fetchBundledWasm('../index.html', async () => {
        fetched = true;
        return new Response('');
      }),
    ).rejects.toThrow();
    expect(fetched).toBe(false);
  });

  it('fails plainly when the decoder will not download, instead of handing pdf.js an error page', async () => {
    await expect(
      fetchBundledWasm('openjpeg.wasm', async () => new Response('<html>', { status: 404 })),
    ).rejects.toThrow();
  });

  it('answers pdf.js through the factory shape it constructs itself', async () => {
    // pdf.js does `new WasmFactory({ baseUrl })` and then `fetch({ filename })`.
    const WasmFactory: new (options: { baseUrl: string | null }) => {
      fetch(request: { filename: string }): Promise<Uint8Array>;
    } = BundledWasmFactory;
    const factory = new WasmFactory({ baseUrl: null });
    await expect(factory.fetch({ filename: 'nothing.wasm' })).rejects.toThrow();
  });

  it('still recovers a good download through the factory', async () => {
    expect(Array.from(await fetchBundledWasm('openjpeg.wasm', ok([7, 8])))).toEqual([7, 8]);
  });
});
