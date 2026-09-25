/**
 * Reads a run-of-show out of a file or pasted text, entirely on this device.
 *
 * PDFs give up their text through PDF.js, photos through on-device OCR
 * (Tesseract), and the lines are then parsed here. Nothing leaves the phone
 * and there is no account or key to add: this used to try a paid model over
 * the network first, which meant a producer setting the app up read that they
 * needed to buy an API key to import a schedule. They never did, and now
 * nothing in the app can bill anyone.
 */

import type { ScheduleItem } from "../types";
import { generateId } from "./id";
import { BundledWasmFactory } from "./pdfPages";
import { borrowMeridiem, minutesBetweenClock, parseDurationSeconds } from "./showTiming";

/** A whole positive number of minutes, or undefined. Anything a source can
 *  state that isn't one — a string, a fraction, a negative, a whole day — is
 *  not a cue length, and a bad one is worse than none: it would silently
 *  reshape the running order's timings. */
function cleanDuration(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  const mins = Math.round(n);
  if (mins <= 0 || mins > 12 * 60) return undefined;
  return mins;
}

/**
 * How long a cue runs, when the row itself says so.
 *
 * The importer used to store no length at all, so every imported show opened
 * with "Cues timed 0/N" and a blank minutes field on every row — even when the
 * schedule it came from stated the length on the page. Read in order of how
 * explicit the source was: a length given outright, then a time range in the
 * text ("8:00–8:20"), then a stated duration ("15 min set").
 *
 * Nothing is invented. A row that doesn't say is left undefined, which is what
 * lets baseDurations keep inferring from the gap to the next cue.
 */
export function deriveDurationMin(
  statedMin: unknown,
  text: string | undefined,
  rangeEnd?: string,
  startTime?: string,
): number | undefined {
  const stated = cleanDuration(statedMin);
  if (stated) return stated;

  const span = minutesBetweenClock(startTime, rangeEnd);
  if (span) return span;

  const seconds = parseDurationSeconds(text);
  if (seconds != null && seconds > 0) return Math.max(1, Math.round(seconds / 60));
  return undefined;
}

/** The parts of a pdf.js text item this file reads; a marked-content marker has none of them. */
type PdfTextPiece = { str: string; hasEOL: boolean; transform: number[] };

/**
 * Put a page's pdf.js text items back on the lines they were printed on.
 *
 * pdf.js hands back one item per run of text and only flags a line break on
 * the item (hasEOL); joining every item with a space flattened a whole page
 * onto one line, and the parser — which takes the first time on each line —
 * then found one cue per page whose text was the rest of the run sheet. When
 * a PDF sets no hasEOL at all, a drop in the item's y position (transform[5])
 * is the next row; a couple of points of slack keeps a superscript or a
 * slightly misaligned glyph on its line.
 */
export function linesFromPdfText(items: ReadonlyArray<PdfTextPiece | { type: string }>): string {
  let text = "";
  let lastY: number | undefined;
  for (const item of items) {
    if (!("str" in item)) continue;
    const y = item.transform?.[5];
    const movedDown = lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 2;
    if (text && !text.endsWith("\n")) text += movedDown ? "\n" : item.str ? " " : "";
    text += item.str;
    if (item.hasEOL) text += "\n";
    lastY = y;
  }
  return text.trim();
}

/**
 * Extract text from PDF files using PDF.js
 */
async function extractTextFromPDF(file: File): Promise<string> {
  // Loaded on demand so pdfjs-dist (a large dependency) stays out of the main
  // bundle, and the legacy build to match the signing page — see
  // utils/pdfPages.ts for why that build. Shipping both would put two copies
  // of pdf.js and two workers, around 1.7 MB, into the deployed app.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    // A scanned schedule is one JPEG 2000 image per page, and pdf.js decodes
    // those only through a decoder it has to ask the page for — see
    // pdfPages.ts. Without this, such a page reads as no text at all.
    WasmFactory: BundledWasmFactory,
    useWorkerFetch: false,
  }).promise;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += linesFromPdfText(textContent.items) + "\n";
  }

  return fullText.trim();
}

/**
 * Check if file is an image
 */
function isImageFile(file: File): boolean {
  return (
    file.type.includes("image") ||
    file.name.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i) !== null
  );
}

/**
 * Extract text from various file formats
 */
async function extractTextFromFile(file: File): Promise<string> {
  const fileType = file.type;

  // Handle text files
  if (
    fileType.includes("text") ||
    fileType.includes("json") ||
    file.name.endsWith(".csv")
  ) {
    return await file.text();
  }

  // Handle PDF files
  if (fileType.includes("pdf") || file.name.endsWith(".pdf")) {
    return await extractTextFromPDF(file);
  }

  // Images have no text to read directly; they go through OCR instead.
  if (isImageFile(file)) {
    return "";
  }

  // Try to read as text for other formats
  try {
    return await file.text();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to read file format: ${fileType}. ${errorMsg}`);
  }
}

/**
 * Run on-device OCR on an image (lazy-loaded so it stays out of the main bundle).
 */
async function ocrImage(file: File): Promise<string> {
  const { recognize } = await import("tesseract.js");
  const { data } = await recognize(file, "eng");
  return data.text ?? "";
}

/**
 * Main function to import schedule from a file
 * Supports text files (.txt, .csv, .json), PDFs, and images (.jpg, .png, etc.)
 *
 * Text and PDF are parsed deterministically; images go through on-device OCR
 * (Tesseract) and then the same parser. No network, no service.
 */
export async function importScheduleFromFile(
  file: File,
): Promise<ScheduleItem[]> {
  if (isImageFile(file)) {
    let ocrText = "";
    try {
      ocrText = await ocrImage(file);
    } catch (error) {
      console.error("OCR failed:", error);
    }
    const ocrItems = parseScheduleManually(ocrText);
    if (ocrItems.length > 0) return ocrItems;

    throw new Error(
      "Couldn't read a schedule from that photo. Make sure the times are clearly visible, or paste the text instead and add cues manually.",
    );
  }

  const text = await extractTextFromFile(file);
  if (!text || text.trim().length === 0) {
    throw new Error("File is empty or contains no readable text.");
  }

  const manualItems = parseScheduleManually(text);
  if (manualItems.length > 0) return manualItems;

  throw new Error(
    'No schedule lines found. Make sure the file has lines with times like "8:00 PM Welcome".',
  );
}

/**
 * Who a cue is for, when the line names them before the segment.
 *
 * Run sheets write "8:35 PM Marisol — headliner", "Devon: opening set" or
 * "June Ito | closer". The part before the separator is a name when it reads
 * like one: one to three capitalised words and nothing else. "Intermission /
 * DJ" and "Doors — bar opens" have no such name and stay a segment. Names the
 * app already knows are matched out of the text separately (see
 * withMatchedPerformers), so this only has to handle the explicit form.
 */
export function splitPerformer(description: string): { performer?: string; description: string } {
  const match = description.match(/^([^—–:|]+?)\s*(?:—|–|:|\||\s-\s)\s*(.+)$/);
  if (!match) return { description };
  const [, left, right] = match;
  const name = left.trim();
  const words = name.split(/\s+/);
  const looksLikeName = words.length <= 3 && words.every((word) => /^[A-Z][\p{L}'’.-]*$/u.test(word))
    && !NOT_A_PERSON.has(name.toLowerCase());
  if (!looksLikeName || !right.trim()) return { description };
  return { performer: name, description: right.trim() };
}

/** Capitalised run-sheet words that sit where a name would but are not one. */
const NOT_A_PERSON = new Set([
  'doors', 'door', 'intermission', 'break', 'interval', 'host', 'hosts', 'mc', 'emcee', 'headliner',
  'closer', 'opener', 'feature', 'dj', 'intro', 'outro', 'welcome', 'set', 'showtime', 'show', 'start',
  'end', 'finish', 'open', 'close', 'curtain', 'soundcheck', 'sound check', 'walk in', 'walk-in', 'encore',
  'raffle', 'announcements', 'note', 'notes', 'reminder', 'lights', 'music', 'bar', 'merch', 'photos',
]);

/**
 * Parse schedule from plain text (deterministic, on this device).
 * Pulls a time and description from each line; handles 12h/24h formats, ranges
 * (8:00–8:20), times anywhere in the line, and leading bullets/separators.
 */
export function parseScheduleManually(text: string): ScheduleItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items: ScheduleItem[] = [];

  // "7:00 PM", "19:00", "7pm", "7 a.m." — a colon-time, or a bare hour with am/pm.
  const timePattern = /\b(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?|\d{1,2}\s*[ap]\.?m\.?)\b/i;
  // "8-8:20pm Devon": the start of a range often has no am/pm of its own, so
  // the pattern above skips it and lands on the range END — the cue then
  // starts twenty minutes late with a stray "8-" in its text. A range whose
  // end carries the meridiem is a time too, and it wins when it begins no
  // later than the first stand-alone time on the line.
  const rangePattern = /\b(\d{1,2}(?::\d{2})?)\s*(?:[-–—]|to)\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\b/i;
  const cleanTime = (raw: string) => raw.replace(/\s+/g, " ").replace(/\.\s*/g, "").trim();

  for (const line of lines) {
    const single = line.match(timePattern);
    const range = line.match(rangePattern);
    const match = range && (!single || (range.index ?? 0) <= (single.index ?? 0)) ? range : single;
    if (!match || match.index === undefined) continue;

    const time = cleanTime(match[1]);
    let description = line.slice(0, match.index) + line.slice(match.index + match[0].length);

    // Take the range-end time out of the description ("8:00–8:20 PM Devon" →
    // after removing "8:00" → "–8:20 PM Devon" → "Devon"). Requires a real range
    // separator so a description that simply starts with a number (e.g. "5 min
    // break") is kept.
    //
    // It's captured rather than discarded: the end of the range is the one
    // place a plain-text schedule states how long a segment runs, and throwing
    // it away is why every imported cue arrived with no minutes on it.
    const rangeMatch = match === range ? null : description.match(
      /^[\s•·*>]*(?:[-–—]|to)\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)(?=\s|$)/i,
    );
    const rangeEnd = match === range ? cleanTime(match[2]) : rangeMatch?.[1] && cleanTime(rangeMatch[1]);
    if (rangeMatch) description = description.slice(rangeMatch[0].length);
    // Trim leading bullets/separators and trailing separators.
    description = description
      .replace(/^[\s\-–—:|•·*.>]+/, "")
      .replace(/[\s\-–—:|]+$/, "")
      .trim();

    if (description) {
      // A range writes the meridiem once, at the end, so the captured start of
      // "8:00-8:20 PM" is a bare "8:00" that reads as morning. Store it with
      // the meridiem it was always meant to have — otherwise the cue sorts and
      // times itself twelve hours out.
      const start = borrowMeridiem(time, rangeEnd);
      const cue = splitPerformer(description);
      items.push({
        id: generateId(),
        time: start,
        description: cue.description,
        performer: cue.performer,
        durationMin: deriveDurationMin(undefined, description, rangeEnd, start),
      });
    }
  }

  return items;
}
