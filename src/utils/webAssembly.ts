/**
 * Whether this page may run WebAssembly: the photo reader is WebAssembly, and
 * so are the decoders pdf.js draws a scanned page's image with.
 *
 * iOS 15 refuses it under the site's Content-Security-Policy: WebKit learned
 * 'wasm-unsafe-eval' only in 16.0, and before that wanted 'unsafe-eval',
 * which the policy leaves out on purpose. Lockdown Mode turns it off
 * altogether. No connection would help with either.
 */
export function webAssemblyRuns(): boolean {
  try {
    // The smallest valid module: the magic number and version 1.
    return new WebAssembly.Module(Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)) instanceof WebAssembly.Module;
  } catch {
    return false;
  }
}
