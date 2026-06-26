// /api/ai-extract — server-side proxy for the optional AI schedule extractor.
//
// The OpenAI key lives ONLY in the server env (OPENAI_API_KEY) and never ships
// in the client bundle. The client posts text or an image and gets back parsed
// schedule rows; if no key is configured the route returns 503 and the client
// falls back to on-device OCR / local parsing. Rate-limited by IP so the route
// can't be turned into an anonymous drain on the account's quota.
import { ensureSchema, getDb } from './_lib/db';
import { exceedsSize, handleError, json, readJson, tooLarge } from './_lib/http';
import { rateLimit } from './_lib/ratelimit';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // images arrive as base64 data URLs

const SYSTEM_PROMPT = `You are a run-of-show schedule extractor. Extract each line/row as a JSON array item with these fields:
- time: string (start time, e.g. "7:00 PM", "19:00"; "" if none)
- description: string (the segment / what happens — e.g. "Opening set", "Host intro", "Intermission")
- performer: string (who is on stage for that segment — a person/act name; "" if it's not a performance, like doors/intermission)

Separate the performer's name from the segment when both are present (e.g. "8:00 Maya — opening set" → performer "Maya", description "opening set").
Return ONLY a valid JSON array, no markdown. If no schedule data is found, return []`;

interface ExtractBody {
  mode: 'text' | 'image';
  text?: string;
  image?: string; // data URL
}

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'user'; content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    if (!OPENAI_API_KEY) return json({ error: 'ai_not_configured' }, 503);

    const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
    await ensureSchema();
    const { allowed } = await rateLimit(getDb(), `ai:${ip}`, 60, 3600);
    if (!allowed) return json({ error: 'too_many_requests' }, 429);

    const body = await readJson<ExtractBody>(req);
    if (exceedsSize(body, MAX_BODY_BYTES)) return tooLarge();

    const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
    if (body.mode === 'image') {
      if (!body.image) return json({ error: 'bad_request' }, 400);
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all schedule items from this image:' },
          { type: 'image_url', image_url: { url: body.image } },
        ],
      });
    } else {
      if (!body.text) return json({ error: 'bad_request' }, 400);
      messages.push({ role: 'user', content: `Extract schedule items from this text:\n\n${body.text}` });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.1, max_tokens: 2000 }),
    });
    if (!response.ok) return json({ error: 'ai_upstream_error', status: response.status }, 502);

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '[]';
    let items: unknown;
    try {
      items = JSON.parse(content);
    } catch {
      return json({ error: 'ai_bad_response' }, 502);
    }
    if (!Array.isArray(items)) return json({ error: 'ai_bad_response' }, 502);

    return json({ items });
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };
