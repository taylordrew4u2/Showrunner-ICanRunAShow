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
 */
export async function importScheduleFromFile(
  file: File,
): Promise<ScheduleItem[]> {
  try {
    // Check if it's an image file - use vision API
    if (isImageFile(file)) {
      const scheduleItems = await extractScheduleFromImage(file);

      if (scheduleItems.length === 0) {
        throw new Error(
          "No schedule data found in the image. Please make sure the image contains time and event information.",
        );
      }

      return scheduleItems;
    }

    // For text and PDF files - extract text first
    const text = await extractTextFromFile(file);

    if (!text || text.trim().length === 0) {
      throw new Error("File is empty or contains no readable text");
    }

    // Use AI to extract schedule items from text
    const scheduleItems = await extractScheduleWithAI(text);

    if (scheduleItems.length === 0) {
      throw new Error(
        "No schedule data found in the file. Please make sure the file contains time and event information.",
      );
    }

    return scheduleItems;
  } catch (error) {
    console.error("Import schedule error:", error);
    throw error;
  }
}

/**
 * Parse schedule from plain text manually (fallback without AI)
 * Looks for time patterns and descriptions on the same line
 */
export function parseScheduleManually(text: string): ScheduleItem[] {
  const lines = text.split("\n").filter((line) => line.trim());
  const items: ScheduleItem[] = [];

  // Common time patterns: "7:00 PM", "19:00", "7pm", etc.
  const timePattern =
    /(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?|\d{1,2}\s*(?:AM|PM|am|pm))/i;

  for (const line of lines) {
    const match = line.match(timePattern);
    if (match) {
      const time = match[1].trim();
      const description = line.replace(match[0], "").trim();

      if (description) {
        items.push({
          id: generateId(),
          time,
          description,
        });
      }
    }
  }

  return items;
}
