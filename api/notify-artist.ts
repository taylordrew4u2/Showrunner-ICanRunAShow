// Vercel serverless function — sends a "you're up" email to an artist.
// Free path: Brevo (https://www.brevo.com) — 300 emails/day on the free plan,
// no domain verification required as long as the sender email is verified in
// Brevo (any email you own works, e.g. your Gmail).
//
// Environment variables (set these in the Vercel project settings):
//   BREVO_API_KEY      — your Brevo v3 API key
//   BREVO_SENDER_EMAIL — the verified sender email (e.g. you@gmail.com)
//   BREVO_SENDER_NAME  — display name (e.g. "I Can Run A Show")

interface NotifyBody {
  name?: string;
  email?: string;
  message?: string;
  subject?: string;
}

function isEmail(v: string | undefined): v is string {
  return !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || 'I Can Run A Show';
  if (!apiKey || !senderEmail) {
    return Response.json(
      { ok: false, error: 'Email is not configured yet. Add BREVO_API_KEY and BREVO_SENDER_EMAIL in Vercel env vars.' },
      { status: 503 },
    );
  }

  let body: NotifyBody;
  try {
    body = (await req.json()) as NotifyBody;
  } catch {
    return Response.json({ ok: false, error: 'Bad JSON' }, { status: 400 });
  }

  const to = body.email?.trim();
  const name = (body.name || 'there').trim();
  const message = (body.message || "You're up — head over for your tattoo.").trim();
  const subject = (body.subject || "You're up!").trim();

  if (!isEmail(to)) {
    return Response.json({ ok: false, error: 'Missing or invalid email.' }, { status: 400 });
  }

  // Build a simple, friendly HTML body. Plain-text fallback included so
  // the message reads well in spam-filter previews.
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f5f5f5;color:#111;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 4px 16px rgba(0,0,0,0.06)">
    <div style="font-size:14px;letter-spacing:0.12em;text-transform:uppercase;color:#e10600;font-weight:800;margin-bottom:8px">You're up</div>
    <div style="font-size:26px;font-weight:900;letter-spacing:-0.02em;line-height:1.1;margin-bottom:12px">Hi ${escapeHtml(name)} —</div>
    <div style="font-size:16px;line-height:1.5;color:#222;margin-bottom:20px">${escapeHtml(message)}</div>
    <div style="font-size:12px;color:#888;border-top:1px solid #eee;padding-top:14px">
      If you don't see this email when expected, please check your spam folder and mark messages from ${escapeHtml(senderEmail)} as "Not spam".
    </div>
  </div>
</body></html>`;
  const text = `Hi ${name},\n\n${message}\n\n(If you don't see future notifications, check your spam folder.)`;

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: to, name }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return Response.json(
        { ok: false, error: `Brevo returned ${res.status}: ${errText.slice(0, 300)}` },
        { status: 502 },
      );
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Network error' },
      { status: 502 },
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const config = { runtime: 'edge' };
