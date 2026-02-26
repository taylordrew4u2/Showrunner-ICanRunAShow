/**
 * AI-powered document parser for extracting show schedule data
 * Uses OpenAI API to intelligently parse various document formats
 */

import type { ScheduleItem } from "../types";
import { generateId } from "./id";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

interface OpenAIMessage {
  role: "system" | "user";
  content: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * Extract text from various file formats
 */
async function extractTextFromFile(file: File): Promise<string> {
  const fileType = file.type;

  // Handle different file types
  if (fileType.includes("text") || fileType.includes("json")) {
    return await file.text();
  }

  if (fileType.includes("pdf")) {
    // For PDFs, we'll need to use a library or convert to text
    // For now, return error message
    throw new Error(
      "PDF parsing requires additional setup. Please use a text file (.txt, .csv, .json) or paste the content directly.",
    );
  }

  // Try to read as text for other formats
  try {
    return await file.text();
  } catch (err) {
    throw new Error(`Unable to read file format: ${fileType}`);
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
 */
export async function importScheduleFromFile(
  file: File,
): Promise<ScheduleItem[]> {
  try {
    // Step 1: Extract text from file
    const text = await extractTextFromFile(file);

    if (!text || text.trim().length === 0) {
      throw new Error("File is empty or contains no readable text");
    }

    // Step 2: Use AI to extract schedule items
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
