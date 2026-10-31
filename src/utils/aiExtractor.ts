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
import { webAssemblyRuns } from "./webAssembly";

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
  const task = pdfjsLib.getDocument({
    data: arrayBuffer,
    // A scanned schedule is one JPEG 2000 image per page, and pdf.js decodes
    // those only through a decoder it has to ask the page for — see
    // pdfPages.ts. Without this, such a page reads as no text at all.
    WasmFactory: BundledWasmFactory,
    useWorkerFetch: false,
  });
  // Destroyed when done, or each import leaves a Web Worker and a parsed copy
  // of the file behind — see pdfPages.ts.
  try {
    const pdf = await task.promise;
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      fullText += linesFromPdfText(textContent.items) + "\n";
    }

    return fullText.trim();
  } finally {
    await task.destroy().catch(() => {});
  }
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
 * (Tesseract) and then the same parser. Nothing is sent to any service, but
 * the OCR engine itself is downloaded the first time a photo is read.
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
      // Almost always the engine failing to download — offline, or a venue
      // network that blocks the CDN it comes from. This used to fall through
      // to "make sure the times are clearly visible", so the producer retook
      // the photo, and every retake failed the same way.
      //
      // The one failure that is the photo's is the engine running and not
      // being able to open the file (a format it cannot decode). Its worker
      // rejects with a plain string, not an Error. Told to find signal for
      // that, the producer would look for a problem they do not have.
      const message = error instanceof Error ? error.message : String(error);
      if (!/attempting to read image/i.test(message)) {
        if (!webAssemblyRuns()) {
          throw new Error(
            "This device can't run the photo reader. It needs iOS 16 or later, or a current browser, with Lockdown Mode off. Paste the text instead.",
          );
        }
        throw new Error(
          "Couldn't start the photo reader. It downloads the first time it's used on this device, so it needs a connection then. Paste the text instead, or try again with signal.",
        );
      }
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
  if (!looksLikeName(name) || !right.trim()) return { description };
  return { performer: name, description: right.trim() };
}

/** One to three capitalised words, and not a run-sheet word: how a name reads. */
function looksLikeName(text: string): boolean {
  const name = text.trim();
  const words = name.split(/\s+/);
  return words.length <= 3 && words.every((word) => /^[A-Z][\p{L}'’.-]*$/u.test(word))
    && !NOT_A_PERSON.has(name.toLowerCase());
}

/** Capitalised run-sheet words that sit where a name would but are not one. */
const NOT_A_PERSON = new Set([
  'doors', 'door', 'intermission', 'break', 'interval', 'host', 'hosts', 'mc', 'emcee', 'headliner',
  'closer', 'opener', 'feature', 'dj', 'intro', 'outro', 'welcome', 'set', 'showtime', 'show', 'start',
  'end', 'finish', 'open', 'close', 'curtain', 'soundcheck', 'sound check', 'walk in', 'walk-in', 'encore',
  'raffle', 'announcements', 'note', 'notes', 'reminder', 'lights', 'music', 'bar', 'merch', 'photos',
  'am', 'pm', 'a.m.', 'p.m.',
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
  // And "7.30pm", the way UK and Australian run sheets write it: without its
  // own rule the bare-hour rule found "00pm" inside "8.00pm" and read noon.
  // A dotted time needs its am/pm, or every price on the sheet would be one.
  const timePattern = /\b(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?|\d{1,2}\.\d{2}\s*[ap]\.?m\.?|\d{1,2}\s*[ap]\.?m\.?)\b/i;
  // "8-8:20pm Devon": the start of a range often has no am/pm of its own, so
  // the pattern above skips it and lands on the range END — the cue then
  // starts twenty minutes late with a stray "8-" in its text. A range whose
  // end carries the meridiem is a time too, and it wins when it begins no
  // later than the first stand-alone time on the line.
  const rangePattern = /\b(\d{1,2}(?:[:.]\d{2})?)\s*(?:[-–—]|to)\s*(\d{1,2}(?:[:.]\d{2})?\s*[ap]\.?m\.?)\b/i;
  // Not every number before a dash starts a range, though: "1 - 8:00 PM Doors"
  // is row one, "Set 2 - 9:30 PM" the second set, "Feb 12 - 8pm" the date.
  // Read as ranges they start in the early afternoon and run for hours — a
  // length the review screen never shows, carried straight into Run Show. No
  // cue runs longer than an evening, so a "range" that does is not one.
  const MAX_RANGE_MIN = 180;
  // It misses a date close to its time, though: "Fri Nov 6 - 8:00 PM" read as
  // a cue from six running two hours. A number straight after a month is the
  // day of the month.
  const AFTER_MONTH = /(?:^|[^\p{L}])(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*$/iu;
  // "8.30pm" is stored as "8:30pm": the rest of the app reads a colon, and
  // dropping the dots of "p.m." would otherwise leave "830pm".
  const cleanTime = (raw: string) =>
    raw.replace(/(\d)\.(\d{2})/, "$1:$2").replace(/\s+/g, " ").replace(/\.\s*/g, "").trim();

  // A row copied out of a spreadsheet arrives as tab-separated cells, and a
  // tab is not a separator anything below reads: "Welcome<tab>Ada Cole" stayed
  // one description with no performer, and an End column stayed in the text
  // with its length lost. The cells are put back into a line the rest of this
  // reads — the first two cells that are only a time as the start and end of
  // a range — and when exactly one other cell reads as a name, that is who is
  // on. Two that both could be (a "Comedy" column beside "Ada Cole") are left
  // for the producer rather than guessed between.
  const isTime = (cell: string) => !cell.replace(timePattern, "").replace(/[\s.]/g, "");
  const readCells = (raw: string): { line: string; columns: boolean; performer?: string } => {
    const cells = raw.split(/\t+/).map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2) return { line: raw, columns: false };
    const times: string[] = [];
    const rest: string[] = [];
    for (const cell of cells) (times.length < 2 && isTime(cell) ? times : rest).push(cell);
    const names = rest.length > 1 ? rest.filter(looksLikeName) : [];
    const performer = names.length === 1 ? names[0] : undefined;
    const words = rest.filter((cell) => cell !== performer).join(" — ");
    return { line: [times.join(" - "), words].filter(Boolean).join(" "), columns: rest.length > 1, performer };
  };

  // A numbered sheet puts its row number where a range starts, and the length
  // check only catches the rows numbered hours before their time: "6 - 8:50 PM
  // Intermission" became a cue from six running 170 minutes, and the rows it
  // did catch kept "1 -" in their text. Numbers that count up from line to
  // line are a list's rows, so they come off before any time is read. Unless
  // every line but the last reads as a range that ends within its hour, the
  // way hourly ranges written "1 - 1:30 PM", "2 - 2:30 PM" do: the rows of a
  // show sit minutes apart, so a row number is soon hours behind its time.
  const ROW_NUMBER = /^(\d{1,3})\s*[-–—.)]\s+/;
  const numbered = lines.filter((line) => ROW_NUMBER.test(line));
  const first = Number(numbered[0]?.match(ROW_NUMBER)?.[1]);
  const counts = numbered.length >= 3
    && numbered.every((line, i) => Number(line.match(ROW_NUMBER)?.[1]) === first + i);
  const hourly = numbered.slice(0, -1).every((line) => {
    const found = line.match(rangePattern);
    const span = found?.index === 0 ? minutesBetweenClock(cleanTime(found[1]), cleanTime(found[2])) : null;
    return span != null && span <= 60;
  });
  const rows = counts && !hourly ? lines.map((line) => line.replace(ROW_NUMBER, "")) : lines;

  for (const raw of rows) {
    const row = readCells(raw);
    const line = row.line;
    const single = line.match(timePattern);
    const found = line.match(rangePattern);
    const dated = found && AFTER_MONTH.test(line.slice(0, found.index));
    const span = found && !dated ? minutesBetweenClock(cleanTime(found[1]), cleanTime(found[2])) : null;
    const range = found && span != null && span <= MAX_RANGE_MIN ? found : null;
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
    //
    // The end may be followed by the colon or comma that introduces the act
    // ("8:00 PM - 8:20 PM: Ada Cole"). Allowing only a space there made the
    // match back off to "8:20", leaving "PM: Ada Cole" — and "PM" on stage.
    const rangeMatch = match === range ? null : description.match(
      /^[\s•·*>]*(?:[-–—]|to)\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?|\d{1,2}\.\d{2}\s*[ap]\.?m\.?)(?=[\s,;:|)\]]|$)/i,
    );
    const rangeEnd = match === range ? cleanTime(match[2]) : rangeMatch?.[1] && cleanTime(rangeMatch[1]);
    if (rangeMatch) description = description.slice(rangeMatch[0].length);
    // Trim leading bullets/separators (and the comma a range end can leave)
    // and trailing separators.
    description = description
      .replace(/^[\s\-–—:;,|•·*.>]+/, "")
      .replace(/[\s\-–—:|]+$/, "")
      .trim();

    if (description) {
      // A range writes the meridiem once, at the end, so the captured start of
      // "8:00-8:20 PM" is a bare "8:00" that reads as morning. Store it with
      // the meridiem it was always meant to have — otherwise the cue sorts and
      // times itself twelve hours out.
      const start = borrowMeridiem(time, rangeEnd);
      const cue = row.columns ? { performer: row.performer, description } : splitPerformer(description);
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
