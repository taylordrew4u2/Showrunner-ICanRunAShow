import { crc32 as zlibCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, createZip, dosDateTime } from './zip';

/**
 * Read a zip back the way an unzip tool does: from the end record, through
 * the central directory, to each local header and its bytes. Written apart
 * from the writer on purpose, so the two cannot agree on a mistake.
 */
function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 4, true)).toBe(0);
  expect(view.getUint16(end + 6, true)).toBe(0);
  const count = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(count);
  const directorySize = view.getUint32(end + 12, true);
  const directoryStart = view.getUint32(end + 16, true);
  expect(view.getUint16(end + 20, true)).toBe(0);
  expect(directoryStart + directorySize).toBe(end);

  const entries = [];
  let at = directoryStart;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const central = {
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      time: view.getUint16(at + 12, true),
      date: view.getUint16(at + 14, true),
      crc: view.getUint32(at + 16, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + view.getUint16(at + 28, true))),
      offset: view.getUint32(at + 42, true),
    };
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);

    const local = central.offset;
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const nameLength = view.getUint16(local + 26, true);
    const extraLength = view.getUint16(local + 28, true);
    const start = local + 30 + nameLength + extraLength;
    entries.push({
      ...central,
      local: {
        flags: view.getUint16(local + 6, true),
        method: view.getUint16(local + 8, true),
        crc: view.getUint32(local + 14, true),
        compressedSize: view.getUint32(local + 18, true),
        size: view.getUint32(local + 22, true),
        name: decoder.decode(bytes.subarray(local + 30, local + 30 + nameLength)),
      },
      data: bytes.slice(start, start + central.compressedSize),
    });
  }
  expect(at).toBe(end);
  return entries;
}

const text = (value: string) => new TextEncoder().encode(value);

describe('the CRC a zip keeps for each file', () => {
  it('matches the standard check value and zlib', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    const noise = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7919) & 0xff);
    expect(crc32(noise)).toBe(zlibCrc32(noise));
  });
});

describe('the time a zip stamps on its files', () => {
  it('packs local time to the even second', () => {
    const { time, date } = dosDateTime(new Date(2026, 9, 20, 21, 45, 31));
    expect(time >> 11).toBe(21);
    expect((time >> 5) & 0x3f).toBe(45);
    expect((time & 0x1f) * 2).toBe(30);
    expect((date >> 9) + 1980).toBe(2026);
    expect((date >> 5) & 0x0f).toBe(10);
    expect(date & 0x1f).toBe(20);
  });

  it('holds a clock set before 1980 at the earliest year a zip can say', () => {
    expect(dosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0);
  });
});

describe('writing a zip', () => {
  const when = new Date(2026, 9, 20, 21, 45, 30);

  it('writes an empty archive as just the end record', () => {
    const zip = createZip([], when);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  it('stores one file byte for byte, with matching headers', () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const [entry] = readZip(createZip([{ name: 'Jane Doe.jpg', data: jpeg }], when));
    expect(entry.name).toBe('Jane Doe.jpg');
    expect(entry.method).toBe(0);
    expect(entry.size).toBe(jpeg.length);
    expect(entry.compressedSize).toBe(jpeg.length);
    expect(entry.crc).toBe(zlibCrc32(jpeg));
    expect(crc32(entry.data)).toBe(entry.crc);
    expect([...entry.data]).toEqual([...jpeg]);
    expect(entry.time).toBe(dosDateTime(when).time);
    expect(entry.date).toBe(dosDateTime(when).date);
    // The local header says the same as the directory: some readers only
    // look at one, and a disagreement is a corrupt archive to the other.
    expect(entry.local).toEqual({
      flags: entry.flags,
      method: 0,
      crc: entry.crc,
      compressedSize: jpeg.length,
      size: jpeg.length,
      name: 'Jane Doe.jpg',
    });
  });

  it('keeps many files in order, each where the directory says it is', () => {
    const files = Array.from({ length: 12 }, (_, i) => ({
      name: `Performer ${i + 1}.png`,
      data: Uint8Array.from({ length: 100 + i * 37 }, (_, j) => (i * 31 + j) & 0xff),
    }));
    const entries = readZip(createZip(files, when));
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    entries.forEach((entry, i) => {
      expect([...entry.data]).toEqual([...files[i].data]);
      expect(entry.crc).toBe(zlibCrc32(files[i].data));
    });
    // Back to back, from the first byte: nothing between one file and the next.
    expect(entries[0].offset).toBe(0);
    for (let i = 1; i < entries.length; i++) {
      const before = entries[i - 1];
      expect(endOf(before)).toBe(entries[i].offset);
    }
  });

  it('keeps an empty file', () => {
    const [entry] = readZip(createZip([{ name: 'blank.jpg', data: new Uint8Array() }], when));
    expect(entry.size).toBe(0);
    expect(entry.crc).toBe(0);
  });

  it('flags every name as UTF-8, so accents and emoji come out as typed', () => {
    const names = ['Zoë Ångström.jpg', 'José Núñez.png', '李小龙.webp', 'Big Mike 🎤.jpg'];
    const entries = readZip(createZip(names.map((name) => ({ name, data: text(name) })), when));
    expect(entries.map((e) => e.name)).toEqual(names);
    for (const entry of entries) {
      expect(entry.flags & 0x0800).toBe(0x0800);
      expect(entry.local.flags & 0x0800).toBe(0x0800);
    }
    // The stored length is in bytes, not characters.
    expect(entries[3].offset - entries[2].offset).toBe(30 + text('李小龙.webp').length + text('李小龙.webp').length);
  });

  it('records the directory where it actually starts', () => {
    const zip = createZip([{ name: 'a.jpg', data: text('aaaa') }, { name: 'b.jpg', data: text('bb') }], when);
    const view = new DataView(zip.buffer);
    const start = view.getUint32(zip.length - 22 + 16, true);
    expect(start).toBe((30 + 5 + 4) + (30 + 5 + 2));
    expect(view.getUint32(start, true)).toBe(0x02014b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(2);
  });
});

function endOf(entry: { offset: number; local: { name: string }; compressedSize: number }): number {
  return entry.offset + 30 + new TextEncoder().encode(entry.local.name).length + entry.compressedSize;
}
