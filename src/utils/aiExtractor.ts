/**
 * AI-powered document parser for extracting show schedule data
 * Uses OpenAI API to intelligently parse various document formats including PDFs and images
 */

import type { ScheduleItem } from "../types";
import { generateId } from "./id";
import * as pdfjsLib from "pdfjs-dist";

// Set up PDF.js worker - use local version from node_modules
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

interface OpenAIMessageText {
  role: "system" | "user";
  content: string;
}

interface OpenAIMessageVision {
  role: "user";
  content: Array<{
    type: "text" | "image_url";
    text?: string;
    image_url?: {
      url: string;
    };
  }>;
}

type OpenAIMessage = OpenAIMessageText | OpenAIMessageVision;

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * Extract text from PDF files using PDF.js
 */
async function extractTextFromPDF(file: File): Promise<string> {
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
 * Use OpenAI Vision to extract schedule items from an image
 */
async function extractScheduleFromImage(file: File): Promise<ScheduleItem[]> {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "OpenAI API key not configured. Please add VITE_OPENAI_API_KEY to your .env.local file.",
    );
  }

  const base64Image = await fileToBase64(file);

  const systemPrompt = `You are a schedule data extractor. Extract schedule items from the provided image and return them as a JSON array.
Each item should have:
- time: string (e.g., "7:00 PM", "19:00", etc.)
- description: string (what happens at that time)

Return ONLY a valid JSON array with no additional text or markdown. Example format:
[
  {"time": "7:00 PM", "description": "Doors open"},
  {"time": "7:30 PM", "description": "Opening act performance"}
]

If no schedule data is found, return an empty array: []`;

  const messages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Extract all schedule items from this image:",
        },
        {
          type: "image_url",
          image_url: {
            url: base64Image,
          },
        },
      ],
    },
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Vision-capable model
        messages,
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`,
      );
    }

    const data: OpenAIResponse = await response.json();
    const content = data.choices[0]?.message?.content || "[]";

    const parsedData = JSON.parse(content);

    if (!Array.isArray(parsedData)) {
      throw new Error("AI returned invalid format (not an array)");
    }

    return parsedData.map((item: { time?: string; description?: string }) => ({
      id: generateId(),
      time: item.time || "",
      description: item.description || "",
    }));
  } catch (error) {
    console.error("AI vision extraction error:", error);
    if (error instanceof Error) {
      throw new Error(
        `Failed to extract schedule from image: ${error.message}`,
      );
    }
    throw new Error("Failed to extract schedule data from image");
  }
}

/**
 * Use OpenAI to extract schedule items from text
 */
async function extractScheduleWithAI(text: string): Promise<ScheduleItem[]> {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "OpenAI API key not configured. Please add VITE_OPENAI_API_KEY to your .env.local file.",
    );
  }

  const systemPrompt = `You are a schedule data extractor. Extract schedule items from the provided text and return them as a JSON array.
Each item should have:
- time: string (e.g., "7:00 PM", "19:00", etc.)
- description: string (what happens at that time)

Return ONLY a valid JSON array with no additional text or markdown. Example format:
[
  {"time": "7:00 PM", "description": "Doors open"},
  {"time": "7:30 PM", "description": "Opening act performance"}
]

If no schedule data is found, return an empty array: []`;

  const messages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Extract schedule items from this text:\n\n${text}`,
    },
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Using the smaller, faster model
        messages,
        temperature: 0.1, // Low temperature for consistent extraction
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`,
      );
    }

    const data: OpenAIResponse = await response.json();
    const content = data.choices[0]?.message?.content || "[]";

    // Parse the AI response
    const parsedData = JSON.parse(content);

    if (!Array.isArray(parsedData)) {
      throw new Error("AI returned invalid format (not an array)");
    }

    // Convert to ScheduleItem format with generated IDs
    return parsedData.map((item: { time?: string; description?: string }) => ({
      id: generateId(),
      time: item.time || "",
      description: item.description || "",
    }));
  } catch (error) {
    console.error("AI extraction error:", error);
    if (error instanceof Error) {
      throw new Error(`Failed to extract schedule data: ${error.message}`);
    }
    throw new Error("Failed to extract schedule data from AI");
  }
}

/**
 * Main function to import schedule from a file
 * Supports text files (.txt, .csv, .json), PDFs, and images (.jpg, .png, etc.)
 *
 * Text and PDF sources ALWAYS fall back to deterministic local parsing when the
 * AI is unavailable (no key, network blocked, or error), so extraction is
 * foolproof for anything that yields text. Images need AI vision (no in-browser
 * OCR), so we surface a clear, actionable message when it can't run.
 */
export async function importScheduleFromFile(
  file: File,
): Promise<ScheduleItem[]> {
  // Images: require AI vision; no local text to parse.
  if (isImageFile(file)) {
    if (!OPENAI_API_KEY) {
      throw new Error(
        "AI is unavailable, so photos can't be read automatically. Paste the schedule text instead, or attach the image as a reference and add cues manually.",
      );
    }
    try {
      const scheduleItems = await extractScheduleFromImage(file);
      if (scheduleItems.length === 0) {
        throw new Error(
          "No schedule data found in the image. Make sure it shows times and events, or paste the text instead.",
        );
      }
      return scheduleItems;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${msg} You can paste the schedule text instead, or attach the image as a reference and add cues manually.`,
      );
    }
  }

  // Text / PDF: extract the text, try AI, then fall back to local parsing.
  const text = await extractTextFromFile(file);
  if (!text || text.trim().length === 0) {
    throw new Error("File is empty or contains no readable text.");
  }

  if (OPENAI_API_KEY) {
    try {
      const aiItems = await extractScheduleWithAI(text);
      if (aiItems.length > 0) return aiItems;
    } catch (error) {
      // AI failed (network/quota/etc.) — fall through to local parsing.
      console.warn("AI extraction failed, falling back to local parsing:", error);
    }
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
