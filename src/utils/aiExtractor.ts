/**
 * AI-powered document parser for extracting show schedule data.
 * Calls the server-side proxy (/api/ai-extract), which holds the OpenAI key —
 * the key never ships in the client bundle. When the server has no key
 * configured the proxy returns 503 and every path falls back to on-device OCR /
 * deterministic local parsing.
 */

import type { ScheduleItem } from "../types";
import { generateId } from "./id";
import { api } from "./api";

interface AIScheduleRow {
  time?: string;
  description?: string;
  performer?: string;
}

/** Call the server proxy; returns mapped items (throws on any failure so callers can fall back). */
async function extractViaProxy(body: { mode: "text"; text: string } | { mode: "image"; image: string }): Promise<ScheduleItem[]> {
  const { items } = await api.post<{ items: AIScheduleRow[] }>("/api/ai-extract", body);
  if (!Array.isArray(items)) throw new Error("AI returned invalid format (not an array)");
  return items.map(mapAIItem);
}

function mapAIItem(item: {
  time?: string;
  description?: string;
  performer?: string;
}): ScheduleItem {
  return {
    id: generateId(),
    time: item.time || "",
    description: item.description || "",
    performer: item.performer || undefined,
  };
}

/**
 * Extract text from PDF files using PDF.js
 */
async function extractTextFromPDF(file: File): Promise<string> {
  // Loaded on demand so pdfjs-dist (a large dependency) stays out of the main bundle.
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    fullText += pageText + "\n";
  }

  return fullText.trim();
}

/**
 * Convert file to base64 data URL for image processing
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

  // For images, return empty string (will be handled by vision API)
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
 * Use AI vision (via the server proxy) to extract schedule items from an image.
 */
async function extractScheduleFromImage(file: File): Promise<ScheduleItem[]> {
  const base64Image = await fileToBase64(file);
  return extractViaProxy({ mode: "image", image: base64Image });
}

/**
 * Use AI (via the server proxy) to extract schedule items from text.
 */
async function extractScheduleWithAI(text: string): Promise<ScheduleItem[]> {
  return extractViaProxy({ mode: "text", text });
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
 * Every path is foolproof without AI: text/PDF fall back to deterministic local
 * parsing, and images fall back to on-device OCR (Tesseract) + local parsing.
 * AI is attempted first via the server proxy; if the server has no key
 * configured (503) or the call fails, we transparently fall back.
 */
export async function importScheduleFromFile(
  file: File,
): Promise<ScheduleItem[]> {
  // Images: try AI vision first, then on-device OCR.
  if (isImageFile(file)) {
    try {
      const aiItems = await extractScheduleFromImage(file);
      if (aiItems.length > 0) return aiItems;
    } catch (error) {
      // AI unavailable (no key / quota / network) — fall through to OCR.
      console.warn("AI vision failed, falling back to OCR:", error);
    }

    let ocrText = "";
    try {
      ocrText = await ocrImage(file);
    } catch (error) {
      console.error("OCR failed:", error);
    }
    const ocrItems = parseScheduleManually(ocrText);
    if (ocrItems.length > 0) return ocrItems;

    throw new Error(
      "Couldn't read a schedule from that photo. Make sure the times are clearly visible, paste the text instead, or attach the image as a reference and add cues manually.",
    );
  }

  // Text / PDF: extract the text, try AI, then fall back to local parsing.
  const text = await extractTextFromFile(file);
  if (!text || text.trim().length === 0) {
    throw new Error("File is empty or contains no readable text.");
  }

  try {
    const aiItems = await extractScheduleWithAI(text);
    if (aiItems.length > 0) return aiItems;
  } catch (error) {
    // AI unavailable (no key / quota / network) — fall through to local parsing.
    console.warn("AI extraction failed, falling back to local parsing:", error);
  }

  const manualItems = parseScheduleManually(text);
  if (manualItems.length > 0) return manualItems;

  throw new Error(
    'No schedule lines found. Make sure the file has lines with times like "8:00 PM Welcome".',
  );
}

/**
 * Parse schedule from plain text manually (deterministic fallback, no AI).
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

  for (const line of lines) {
    const match = line.match(timePattern);
    if (!match || match.index === undefined) continue;

    const time = match[1].replace(/\s+/g, " ").replace(/\.\s*/g, "").trim();
    let description = line.slice(0, match.index) + line.slice(match.index + match[0].length);

    // Drop a leftover range-end time ("8:00–8:20 PM Devon" → after removing
    // "8:00" → "–8:20 PM Devon" → "Devon"). Requires a real range separator so
    // a description that simply starts with a number (e.g. "5 min break") is kept.
    description = description.replace(
      /^[\s•·*>]*(?:[-–—]|to)\s*\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?(?=\s|$)/i,
      "",
    );
    // Trim leading bullets/separators and trailing separators.
    description = description
      .replace(/^[\s\-–—:|•·*.>]+/, "")
      .replace(/[\s\-–—:|]+$/, "")
      .trim();

    if (description) {
      items.push({ id: generateId(), time, description });
    }
  }

  return items;
}
