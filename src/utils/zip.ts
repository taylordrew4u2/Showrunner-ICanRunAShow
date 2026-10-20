/**
 * A .zip file, written here rather than pulled in from a library.
 *
 * The only archive the app makes is a lineup's headshots, and those are JPEGs
 * and PNGs that are already as small as compression will make them. Deflating
 * them again would cost a phone time for no saving, so every entry is STOREd:
 * the bytes go in as they are, behind the headers a zip reader expects. That
 * leaves a CRC and some bookkeeping, which is a page of code, not a dependency
 * the service worker has to cache.
 *
 * Names are flagged as UTF-8 (general purpose bit 11). Without the flag a
 * reader falls back to the old DOS code page, and a comic called Zoë or José
 * came out of the archive under a name nobody typed.
 *
 * No ZIP64: a lineup's headshots are a few megabytes, nowhere near the 4 GB or
 * 65,535 files a plain zip can describe, and an archive past either limit is
 * refused rather than written wrong.
 */

export interface ZipEntry {
  /** The file's name inside the archive. A "/" in it would make a folder. */
  name: string;
  data: Uint8Array;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_SIZE = 22;
/** 2.0: the oldest version that reads a stored entry with these headers. */
const VERSION = 20;
const UTF8_NAMES = 0x0800;
const STORED = 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 a zip records for each entry (the same one gzip and PNG use). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A moment in the two 16-bit fields a zip stores it in: local time, to the
 * even second, between 1980 and 2107.
 */
export function dosDateTime(when: Date): { time: number; date: number } {
  const year = Math.min(Math.max(when.getFullYear(), 1980), 2107);
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/**
 * The bytes of a zip holding `entries`, in order, every one stamped `modified`.
 *
 * Built in one buffer sized up front: each entry's local header and data,
 * then the central directory that indexes them, then the record that says
 * where that directory starts.
 */
export function createZip(entries: ZipEntry[], modified: Date = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(modified);
  const files = entries.map((entry) => ({
    name: encoder.encode(entry.name),
    data: entry.data,
    crc: crc32(entry.data),
  }));

  let total = END_SIZE;
  for (const file of files) {
    if (file.name.length > 0xffff) throw new Error('A file name is too long for a zip.');
    total += LOCAL_HEADER_SIZE + CENTRAL_HEADER_SIZE + file.name.length * 2 + file.data.length;
  }
  if (files.length > 0xffff || total > 0xffffffff) {
    throw new Error('Too much to fit in one zip.');
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let at = 0;

  for (const file of files) {
    offsets.push(at);
    view.setUint32(at, LOCAL_HEADER, true);
    view.setUint16(at + 4, VERSION, true);
    view.setUint16(at + 6, UTF8_NAMES, true);
    view.setUint16(at + 8, STORED, true);
    view.setUint16(at + 10, time, true);
    view.setUint16(at + 12, date, true);
    view.setUint32(at + 14, file.crc, true);
    view.setUint32(at + 18, file.data.length, true); // compressed size
    view.setUint32(at + 22, file.data.length, true); // uncompressed size
    view.setUint16(at + 26, file.name.length, true);
    view.setUint16(at + 28, 0, true); // no extra field
    out.set(file.name, at + LOCAL_HEADER_SIZE);
    out.set(file.data, at + LOCAL_HEADER_SIZE + file.name.length);
    at += LOCAL_HEADER_SIZE + file.name.length + file.data.length;
  }

  const directoryStart = at;
  files.forEach((file, i) => {
    view.setUint32(at, CENTRAL_HEADER, true);
    view.setUint16(at + 4, VERSION, true); // made by: MS-DOS attributes, spec 2.0
    view.setUint16(at + 6, VERSION, true);
    view.setUint16(at + 8, UTF8_NAMES, true);
    view.setUint16(at + 10, STORED, true);
    view.setUint16(at + 12, time, true);
    view.setUint16(at + 14, date, true);
    view.setUint32(at + 16, file.crc, true);
    view.setUint32(at + 20, file.data.length, true);
    view.setUint32(at + 24, file.data.length, true);
    view.setUint16(at + 28, file.name.length, true);
    view.setUint16(at + 30, 0, true); // extra field length
    view.setUint16(at + 32, 0, true); // comment length
    view.setUint16(at + 34, 0, true); // disk the file starts on
    view.setUint16(at + 36, 0, true); // internal attributes
    view.setUint32(at + 38, 0, true); // external attributes
    view.setUint32(at + 42, offsets[i], true);
    out.set(file.name, at + CENTRAL_HEADER_SIZE);
    at += CENTRAL_HEADER_SIZE + file.name.length;
  });

  view.setUint32(at, END_OF_CENTRAL_DIRECTORY, true);
  view.setUint16(at + 4, 0, true); // this disk
  view.setUint16(at + 6, 0, true); // disk the directory starts on
  view.setUint16(at + 8, files.length, true); // entries on this disk
  view.setUint16(at + 10, files.length, true); // entries in all
  view.setUint32(at + 12, at - directoryStart, true);
  view.setUint32(at + 16, directoryStart, true);
  view.setUint16(at + 20, 0, true); // no archive comment

  return out;
}
