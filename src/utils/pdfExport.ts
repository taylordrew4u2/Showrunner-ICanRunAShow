import { buildIntroCards, type IntroCard } from "./introCards";
import { showDJSongs } from "./musicLibrary";
import { recapMoney } from "./recapMoney";
import { isSurpriseGuest, SURPRISE_GUEST_LABEL } from "./surpriseGuests";
import type {
  Show,
  AppSettings,
  Performer,
  Artist,
  ScheduleItem,
  Host,
  DJSong,
  MusicTrack,
  StaffMember,
  Vendor,
  Expense,
  Scene,
  TodoItem,
} from "../types";

function esc(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCurrency(amount: number): string {
  // The sign before the dollar, "-$40.00" rather than "$-40.00", now that a
  // night's profit or loss is often a loss. Taken from the amount rounded to
  // the cent, so float dust never prints as "-$0.00".
  const cents = Math.round(amount * 100);
  return `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** How long a print sheet gets before its hidden frame is tidied away regardless. */
const PRINT_FRAME_LIFETIME_MS = 60_000;

/**
 * The house faces for a printed sheet: Cormorant Garamond for names, Inter
 * for everything else, self-hosted like the app's own. The URLs are absolute
 * because the sheet is written into a blank window, which has no base URL of
 * its own to resolve "/fonts/…" against.
 */
function houseFontFaces(): string {
  const origin = typeof location !== "undefined" && /^https?:/.test(location.origin) ? location.origin : "";
  const face = (family: string, style: string, weight: string, file: string) =>
    `@font-face { font-family: '${family}'; font-style: ${style}; font-weight: ${weight}; font-display: swap; src: url('${origin}/fonts/${file}') format('woff2'); }`;
  return [
    face("Inter", "normal", "350 800", "inter-latin.woff2"),
    face("Cormorant Garamond", "normal", "300 700", "cormorant-garamond-latin.woff2"),
  ].join("\n    ");
}

/** The ink and paper every printed sheet shares. */
const SERIF = "'Cormorant Garamond', Garamond, 'Times New Roman', serif";
const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/**
 * Put a printable page in front of the producer.
 *
 * A new tab where the browser gives one. The iOS shell never does: Capacitor
 * answers every window.open by handing the URL to the system and returning
 * null, so a blank tab for the runsheet is null and the export button did
 * nothing at all — no sheet, no error. A popup blocker on a desktop does the
 * same. Either way the page is printed from here instead: a hidden frame in
 * this document, printed, then removed so nothing is left behind.
 */
export function openPrintable(html: string): void {
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 300);
    return;
  }

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("title", "Print preview");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  const remove = () => frame.remove();
  doc.open();
  doc.write(html);
  doc.close();
  // Gone once the print dialog closes; and gone anyway after a minute, for
  // the browsers that never say. Listened for only now: opening the document
  // above replaces it and drops every listener on its window with it.
  win.addEventListener("afterprint", remove);
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      remove();
      return;
    }
    setTimeout(remove, PRINT_FRAME_LIFETIME_MS);
  }, 300);
}

/**
 * A printable page of intro cards, one per act, in the order the host will
 * read them. Empty bill, no page — a blank sheet headed "Intro cards" is worse
 * than no sheet at all.
 */
function introCardsSection(show: Show): string {
  const cards = buildIntroCards(show);
  if (cards.length === 0) return "";

  return `
  <div class="cards-page">
    <h2>Intro cards</h2>
    <p class="cards-note">One per act, in running order. Cut along the boxes.</p>
    <div class="cards">
      ${cards.map(renderIntroCard).join("")}
    </div>
  </div>`;
}

/*
 * Fitting the credits on an intro card.
 *
 * The card is a fixed height, so credits too long for it used to stop at
 * whatever line the card ran out on, with nothing to show there was more.
 * Now they are set smaller until they fit, and if they still don't at the
 * smallest size they end in an ellipsis. The sheet goes straight to the print
 * dialog with no chance to measure anything, so the fit is worked out here
 * from the card's text, and every estimate errs toward too many lines: the
 * credits shrink a step early rather than run off the card.
 */

/**
 * The sizes credits can be set in, largest first, each with its line height,
 * which is also the pitch the credits are ruled at, so they sit on the lines
 * at every size. 11px is the floor: the smallest a host can still read at
 * arm's length under a stage light. The sheet's .card__credits rule and its
 * --12 and --11 modifiers say the same.
 */
const CREDIT_STEPS = [
  { px: 13, lineHeight: 28 },
  { px: 12, lineHeight: 24 },
  { px: 11, lineHeight: 18 },
] as const;

type CreditStep = (typeof CREDIT_STEPS)[number];

/**
 * How wide a card's text runs at the narrowest, in CSS px: half an A4 sheet
 * inside half-inch print margins (Firefox's default), less the card's border
 * and padding. Letter paper and narrower margins give a little more.
 */
const CARD_TEXT_PX = 284;

/**
 * How wide a face sets each kind of character, in ems: a space; lower case
 * and the slim punctuation; capitals, figures and the rest; and the widest
 * letters and signs, with anything outside Latin (an emoji, the ♪). Each is a
 * little over the face's own average, so an estimate errs toward more lines.
 * Capitals are counted apart because they run a third to a half wider than
 * lower case: at one flat width per character, a name in capitals that wraps
 * on the card was counted as one line, and the credits' last line, ellipsis
 * and all, printed off the bottom.
 */
interface FaceEm {
  space: number;
  slim: number;
  wide: number;
  widest: number;
}
const INTER_EM: FaceEm = { space: 0.3, slim: 0.56, wide: 0.72, widest: 1 };
const CORMORANT_EM: FaceEm = { space: 0.25, slim: 0.46, wide: 0.7, widest: 0.95 };

/** The width of one character in a face, in ems. */
function charEm(ch: string, em: FaceEm): number {
  if (/\s/.test(ch)) return em.space;
  if (/[MW@%—…]|[^\u0020-\u024F\u2010-\u2027]/u.test(ch)) return em.widest;
  if (/[\p{Ll}.,:;'’‘!|()[\]-]/u.test(ch)) return em.slim;
  return em.wide;
}

/**
 * The card's height as the sheet lays it out, in CSS px. Change one there,
 * change it here: the 2.5in card less its border and padding, the name over
 * its rule (a line of 25px at 1.1, then padding, rule and margin), and the
 * foot under its hairline (margin, hairline and padding, then its lines).
 */
const CARD_INNER_PX = 240 - 2 - 14 - 10;
const NAME_PX = 25;
const NAME_LINE_PX = 27.5;
const UNDER_NAME_PX = 6 + 1 + 8;
const FOOT_LINE_PX = 14;
const OVER_FOOT_PX = 6 + 1 + 6;
/** The name keeps clear of the card number in the corner. */
const NAME_TEXT_PX = CARD_TEXT_PX - 28;
/** The foot's walk-on and handle are set apart by this much. */
const FOOT_GAP_PX = 10;
const FOOT_PX = 11;

/** The room most cards leave the credits: a name on one line, a foot on one line. */
const USUAL_CREDITS_ROOM_PX = CARD_INNER_PX - NAME_LINE_PX - UNDER_NAME_PX - OVER_FOOT_PX - FOOT_LINE_PX;

/** How wide text runs in a face at this size, in CSS px. */
function textPx(text: string, em: FaceEm, px: number): number {
  let width = 0;
  for (const ch of text) width += charEm(ch, em) * px;
  return width;
}

/**
 * How many lines text in a face at this size wraps to across this width,
 * breaking at spaces as the browser does, and through any word too long for
 * a line of its own (the card sets word-break: break-word).
 */
function wrappedLines(text: string, em: FaceEm, px: number, widthPx: number): number {
  const space = em.space * px;
  let lines = 0;
  // Full, so the first word opens the first line.
  let used = widthPx;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const wordPx = textPx(word, em, px);
    if (used + space + wordPx <= widthPx) {
      used += space + wordPx;
      continue;
    }
    lines += 1;
    used = 0;
    for (const ch of word) {
      const chPx = charEm(ch, em) * px;
      if (used > 0 && used + chPx > widthPx) {
        lines += 1;
        used = 0;
      }
      used += chPx;
    }
  }
  return Math.max(lines, 1);
}

/** What the right of a card's foot says: the act's handle, after "Surprise guest" for one. */
function footRight(card: IntroCard): string {
  const handle = card.social || (card.kind === "artist" ? "Artist" : "");
  // A surprise guest's card says so first, where the host's thumb is.
  return card.surprise ? [SURPRISE_GUEST_LABEL, handle].filter(Boolean).join(" · ") : handle;
}

/** The height this card leaves its credits, between its name and its foot. */
function creditsRoomPx(card: IntroCard): number {
  const nameLines = wrappedLines(card.name, CORMORANT_EM, NAME_PX, NAME_TEXT_PX);
  let room = CARD_INNER_PX - nameLines * NAME_LINE_PX - UNDER_NAME_PX;
  const right = footRight(card);
  if (card.walkOn || right) {
    // The handle never wraps, so a long walk-on wraps in what it leaves, and
    // every line it takes comes off the credits.
    const walkOnPx = CARD_TEXT_PX - FOOT_GAP_PX - textPx(right, INTER_EM, FOOT_PX);
    const footLines = card.walkOn ? wrappedLines(`♪ ${card.walkOn}`, INTER_EM, FOOT_PX, walkOnPx) : 1;
    room -= OVER_FOOT_PX + footLines * FOOT_LINE_PX;
  }
  return room;
}

/** How many whole lines of credits at this step fit in this much room. */
function creditLines(step: CreditStep, roomPx: number): number {
  return Math.max(1, Math.floor(roomPx / step.lineHeight));
}

/** The largest step the credits fit at in this room, or the smallest when they fit at none. */
function creditsStep(text: string, roomPx: number): CreditStep {
  const fits = CREDIT_STEPS.find(
    (step) => wrappedLines(text, INTER_EM, step.px, CARD_TEXT_PX) <= creditLines(step, roomPx),
  );
  return fits ?? CREDIT_STEPS[CREDIT_STEPS.length - 1];
}

/**
 * The type size for a card's credits, in CSS px: the house 13px when they fit
 * at it, stepping down to 12px and then 11px as they get longer. Credits too
 * long even at 11px stay at 11px and are clamped. The room is the height the
 * card leaves them; most cards leave the default.
 */
export function creditsFontPx(text: string, roomPx: number = USUAL_CREDITS_ROOM_PX): number {
  return creditsStep(text, roomPx).px;
}

function renderCardCredits(card: IntroCard): string {
  if (!card.credits) return `<div class="card__credits card__credits--none">No credits on file</div>`;
  const room = creditsRoomPx(card);
  const step = creditsStep(card.credits, room);
  const lines = creditLines(step, room);
  const classes = ["card__credits"];
  if (step !== CREDIT_STEPS[0]) classes.push(`card__credits--${step.px}`);
  // Clamped to the lines there's room for whenever they might fill them, so
  // if they run over after all, the last line says so with an ellipsis. The
  // box stops at those lines too: one any taller can show the top of the next.
  const clamp = wrappedLines(card.credits, INTER_EM, step.px, CARD_TEXT_PX) >= lines;
  if (clamp) classes.push("card__credits--clamp");
  const style = clamp ? ` style="-webkit-line-clamp: ${lines}; max-height: ${lines * step.lineHeight}px"` : "";
  return `<div class="${classes.join(" ")}"${style}>${esc(card.credits)}</div>`;
}

/** Only drawn when it has something to say — an empty foot is a stray rule. */
function renderCardFoot(card: IntroCard): string {
  const right = footRight(card);
  if (!card.walkOn && !right) return "";
  return `
        <div class="card__foot">
          <span class="card__walkon">${card.walkOn ? `♪ ${esc(card.walkOn)}` : ""}</span>
          <span class="card__kind">${esc(right)}</span>
        </div>`;
}

function renderIntroCard(card: IntroCard): string {
  return `
      <div class="card">
        <div class="card__num">${card.order}</div>
        <div class="card__name">${esc(card.name)}</div>
        ${renderCardCredits(card)}
        ${renderCardFoot(card)}
      </div>`;
}

export function exportShowToPDF(show: Show, settings: AppSettings): void {
  // The same list the show runs on: its own songs plus the music library.
  const djSongs = showDJSongs(show, settings.musicLibrary ?? []);
  const totalExpenses = show.expenses.reduce(
    (sum, e) => sum + (Number(e.cost) || 0),
    0,
  );
  // Worked out here from the vendors and the recap's figures, not read from
  // the stored profitLoss, which a vendor's later change of cost left behind.
  const money = recapMoney(show.recap, show.vendors ?? []);
  const recapStat = (label: string, value: string) =>
    `<div class="recap-stat"><div class="recap-stat__label">${label}</div><div class="recap-stat__value">${value}</div></div>`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(show.name)}</title>
  <style>
    ${houseFontFaces()}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${SANS}; padding: 40px; color: #141413; background: #fff; font-size: 13px; }
    .brand { font-family: ${SERIF}; color: #141413; font-size: 18px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 4px; }
    .producers { color: #55524c; margin-bottom: 16px; font-size: 13px; }
    h1 { font-family: ${SERIF}; font-size: 30px; font-weight: 500; line-height: 1.1; color: #141413; margin-bottom: 8px; }
    .meta { color: #55524c; margin-bottom: 4px; font-size: 13px; }
    .meta strong { color: #141413; font-weight: 600; }
    h2 { font-family: ${SERIF}; font-size: 20px; font-weight: 500; color: #141413; border-bottom: 1px solid #c9c5bd; padding-bottom: 6px; margin: 26px 0 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    /* No fill: tracked capitals over an ink rule, which a printer keeps even
       when it drops backgrounds. */
    th { background: none; color: #141413; padding: 8px 12px 6px; text-align: left; font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; border-bottom: 1px solid #141413; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td { padding: 7px 12px; border-bottom: 1px solid #e4e1da; font-size: 13px; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .total-row td { font-weight: 600; background: none; border-top: 1px solid #141413; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .rules-box { border: 1px solid #c9c5bd; border-radius: 0; padding: 14px; margin-top: 10px; white-space: pre-wrap; font-size: 13px; }
    .section-empty { color: #6b675f; font-style: italic; font-size: 12px; padding: 6px 0; }
    .badge { display: inline-block; background: none; color: #55524c; border-radius: 0; padding: 0; font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; margin-left: 8px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .badge--green::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #2f7d4f; margin-right: 6px; vertical-align: 1px; }
    .todo-item { padding: 4px 0; border-bottom: 1px solid #e4e1da; font-size: 13px; }
    .todo-item:last-child { border-bottom: none; }
    .todo-done { text-decoration: line-through; color: #6b675f; }
    .recap-box { border: 1px solid #c9c5bd; border-radius: 0; padding: 14px; margin-top: 10px; }
    .recap-row { display: flex; gap: 32px; flex-wrap: wrap; margin-bottom: 10px; }
    .recap-stat { min-width: 120px; }
    .recap-stat__label { font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #55524c; }
    .recap-stat__value { font-size: 18px; font-weight: 600; color: #141413; font-variant-numeric: tabular-nums; }
    .recap-notes { margin-top: 10px; font-size: 13px; white-space: pre-wrap; }

    /* ── Intro cards ──────────────────────────────────────────────────
       The stack the host reads from at the mic. Printed to look like the
       index cards they replace — ruled lines, a rule under the name —
       because that is the thing a host already knows how to hold and shuffle.

       Two to a row and a fixed height so a sheet cuts into even cards, and
       page-break-inside so none of them ever straddles a fold. */
    .cards-page { page-break-before: always; }
    .cards-note { color: #55524c; font-size: 12px; margin: 0 0 14px; }
    .cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .card {
      position: relative;
      height: 2.5in;
      padding: 14px 16px 10px;
      border: 1px solid #c9c5bd;
      border-radius: 0;
      background: #fff;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
      /* A column: the name, the credits, then the foot as tall as its lines.
         The credits get what the other two leave; see .card__credits. The
         heights here are budgeted in CARD_INNER_PX and the constants after
         it, which work out how much of the credits fits. */
      display: flex;
      flex-direction: column;
    }
    .card__num {
      position: absolute;
      top: 10px;
      right: 12px;
      font-size: 11px;
      font-weight: 600;
      color: #6b675f;
      font-variant-numeric: tabular-nums;
    }
    .card__name {
      font-family: ${SERIF};
      font-size: 25px;
      font-weight: 600;
      line-height: 1.1;
      color: #141413;
      padding-bottom: 6px;
      margin-bottom: 8px;
      border-bottom: 1px solid #141413;
      padding-right: 28px;
      word-break: break-word;
    }
    .card__credits {
      font-size: 13px;
      line-height: 28px;
      color: #141413;
      word-break: break-word;
      /* Long credits used to run on under the foot and print over the
         walk-on cue, so the host could read neither. They now stop above it. */
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
      /* The faint ruling: one rule to each line of credits, along the foot
         of the letters, where it has always printed. It is drawn on the
         credits rather than across the whole card so it keeps to their
         lines at any size, and wherever a two-line name leaves them.
         Printers strip backgrounds by default, hence the print-color-adjust
         on .card below, which this inherits — without it these cards come
         out blank. */
      background-image: linear-gradient(to bottom, transparent calc(100% - 1px), #ebe8e2 calc(100% - 1px));
      background-size: 100% 28px;
      background-position: 0 -10.5px;
    }
    /* Credits too long for the card at 13px are set smaller (creditsFontPx
       picks the size) and ruled closer to match, the rule in the same place
       on each line. */
    .card__credits--12 { font-size: 12px; line-height: 24px; background-size: 100% 24px; background-position: 0 -8.5px; }
    .card__credits--11 { font-size: 11px; line-height: 18px; background-size: 100% 18px; background-position: 0 -5.5px; }
    /* Credits that may still fill the card end in an ellipsis on the last
       line it has room for, instead of stopping mid-sentence with no sign
       there was more. That line count, and a height to match, are set on
       each card. Whatever room is left under them goes above the foot. */
    .card__credits--clamp {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      margin-bottom: auto;
    }
    .card__credits--none { color: #6b675f; font-style: italic; }
    .card__foot {
      /* In the column under the credits, not pinned over them with a fixed
         space kept clear, so it is as tall as its lines: a walk-on that
         wraps to a second line takes that line from the credits instead of
         printing over them. */
      flex: none;
      margin-top: 6px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 11px;
      line-height: 14px;
      color: #55524c;
      border-top: 1px solid #e4e1da;
      padding-top: 6px;
    }
    .card__walkon { font-weight: 600; }
    .card__kind { color: #6b675f; white-space: nowrap; }

    @media print {
      body { padding: 24px; }
      .card {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="brand">${esc(settings.brandName)}</div>
  ${settings.producers.length > 0 ? `<div class="producers">Producers: ${settings.producers.map((p) => `${esc(p.name)} (${esc(p.role)})`).join(", ")}</div>` : ""}

  <h1>${esc(show.name)}</h1>
  ${show.date ? `<div class="meta"><strong>Date:</strong> ${esc(show.date)}</div>` : ""}
  ${show.time ? `<div class="meta"><strong>Time:</strong> ${esc(show.time)}</div>` : ""}
  ${show.venueName ? `<div class="meta"><strong>Venue:</strong> ${esc(show.venueName)}</div>` : ""}
  ${show.location ? `<div class="meta"><strong>Location:</strong> ${esc(show.location)}</div>` : ""}
  ${show.ticketLink ? `<div class="meta"><strong>Ticket Link:</strong> <a href="${esc(show.ticketLink)}">${esc(show.ticketLink)}</a></div>` : ""}
  ${show.status ? `<div class="meta"><strong>Status:</strong> ${esc(show.status)}</div>` : ""}
  ${show.host ? `<div class="meta"><strong>Host:</strong> ${esc(show.host)}</div>` : ""}

  ${
    show.performers.length > 0
      ? `
  <h2>Performers</h2>
  <table>
    <tr><th>#</th><th>Name</th><th>Social Media</th><th>Walk-On Music</th><th>Walk-On Timestamp</th><th>Credits</th></tr>
    ${show.performers.map((p: Performer, i: number) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(p.name)}${isSurpriseGuest(p) ? `<span class="badge">${SURPRISE_GUEST_LABEL}</span>` : ""}</td>
      <td>${esc(p.socialMedia)}</td>
      <td>${p.walkOnMusicName ? esc(p.walkOnMusicName) : "—"}</td>
      <td>${esc(p.walkOnMusicTimestamp)}</td>
      <td>${esc(p.credits)}</td>
    </tr>`).join("")}
  </table>`
      : ""
  }

  ${
    (show.artists?.length ?? 0) > 0
      ? `
  <h2>Artists</h2>
  <table>
    <tr><th>#</th><th>Name</th><th>Type</th><th>Walk-On Music</th></tr>
    ${show.artists.map((a: Artist, i: number) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(a.name)}</td>
      <td>${esc(a.artistType)}</td>
      <td>${a.walkOnMusicName ? esc(a.walkOnMusicName) : "—"}</td>
    </tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.schedule.length > 0
      ? `
  <h2>Schedule &amp; Timing</h2>
  <table>
    <tr><th>Time</th><th>Event</th></tr>
    ${show.schedule.map((s: ScheduleItem) => `<tr><td>${esc(s.time)}</td><td>${esc(s.description)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.hosts.length > 0
      ? `
  <h2>Hosts</h2>
  <table>
    <tr><th>Name</th><th>Hosting</th><th>Notes</th></tr>
    ${show.hosts.map((h: Host) => `<tr><td>${esc(h.name)}</td><td>${h.isHosting ? "✓ Yes" : "No"}</td><td>${esc(h.notes)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    djSongs.length > 0
      ? `
  <h2>DJ Music List</h2>
  <table>
    <tr><th>#</th><th>Title</th><th>Artist</th><th>Notes</th></tr>
    ${djSongs.map((s: DJSong, i: number) => `<tr><td>${i + 1}</td><td>${esc(s.title)}</td><td>${esc(s.artist)}</td><td>${esc(s.notes)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.staff.length > 0
      ? `
  <h2>Staff &amp; Crew</h2>
  <table>
    <tr><th>Role</th><th>Person</th><th>Phone</th></tr>
    ${show.staff.map((s: StaffMember) => `<tr><td>${esc(s.role)}</td><td>${esc(s.personName)}</td><td>${esc(s.phone)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    (show.vendors?.length ?? 0) > 0
      ? `
  <h2>Vendors</h2>
  <table>
    <tr><th>Vendor</th><th>Category</th><th>Contact</th><th>Phone</th><th>Email</th><th>Cost</th><th>Booked</th><th>Notes</th></tr>
    ${show.vendors!.map((v: Vendor) => `<tr><td>${esc(v.name)}</td><td>${esc(v.category)}</td><td>${esc(v.contactName)}</td><td>${esc(v.phone)}</td><td>${esc(v.email)}</td><td>${typeof v.cost === "number" && !Number.isNaN(v.cost) ? formatCurrency(v.cost) : ""}</td><td>${v.booked ? "Yes" : "No"}</td><td>${esc(v.notes)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.expenses.length > 0
      ? `
  <h2>Itemized Expenses</h2>
  <table>
    <tr><th>Category</th><th>Item</th><th>Cost</th><th>Date</th><th>Notes</th></tr>
    ${show.expenses.map((e: Expense) => `<tr><td>${esc(e.category)}</td><td>${esc(e.itemName)}</td><td>${formatCurrency(Number(e.cost) || 0)}</td><td>${esc(e.date)}</td><td>${esc(e.notes)}</td></tr>`).join("")}
    <tr class="total-row"><td colspan="2"><strong>Total</strong></td><td><strong>${formatCurrency(totalExpenses)}</strong></td><td></td><td></td></tr>
  </table>`
      : ""
  }

  ${
    (show.scenes?.length ?? 0) > 0
      ? `
  <h2>Scenes</h2>
  <table>
    <tr><th>#</th><th>Title</th><th>Description</th><th>Duration</th><th>Status</th></tr>
    ${(show.scenes as Scene[]).map((sc: Scene, i: number) => `<tr><td>${i + 1}</td><td>${esc(sc.title)}</td><td>${esc(sc.description)}</td><td>${sc.duration > 0 ? `${sc.duration} min` : "—"}</td><td>${esc(sc.status)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    (show.todos?.length ?? 0) > 0
      ? `
  <h2>To-Do List</h2>
  <div style="margin-bottom: 10px;">
    ${(show.todos as TodoItem[]).map((t: TodoItem) => `<div class="todo-item ${t.completed ? "todo-done" : ""}">${t.completed ? "☑" : "☐"} ${esc(t.text)}</div>`).join("")}
  </div>`
      : ""
  }

  ${
    show.recap
      ? `
  <h2>Show Recap</h2>
  <div class="recap-box">
    <div class="recap-row">
      ${show.recap.attendance != null ? recapStat("Attendance", String(show.recap.attendance)) : ""}
      ${show.recap.ticketSales != null ? recapStat("Ticket Sales", formatCurrency(money.ticketSales)) : ""}
      ${show.recap.merchSales != null ? recapStat("Merch Sales", formatCurrency(money.merchSales)) : ""}
      ${money.vendorCosts !== 0 ? recapStat("Vendor Costs", formatCurrency(money.vendorCosts)) : ""}
      ${show.recap.otherCosts != null ? recapStat("Other Costs", formatCurrency(money.otherCosts)) : ""}
      ${money.revenue !== 0 || money.costs !== 0 ? recapStat("Profit / Loss", formatCurrency(money.profitLoss)) : ""}
    </div>
    ${show.recap.performerNotes ? `<div class="recap-notes"><strong>Performer Notes:</strong>\n${esc(show.recap.performerNotes.trim())}</div>` : ""}
    ${show.recap.improvementNotes ? `<div class="recap-notes" style="margin-top:8px;"><strong>Improvement Notes:</strong>\n${esc(show.recap.improvementNotes.trim())}</div>` : ""}
  </div>`
      : ""
  }

  ${
    settings.rules
      ? `
  <h2>Rules</h2>
  <div class="rules-box">${esc(settings.rules)}</div>`
      : ""
  }

  ${introCardsSection(show)}

</body>
</html>`;

  openPrintable(html);
}

export function exportDJListToPDF(show: Show, library: MusicTrack[] = []): void {
  const djSongs = showDJSongs(show, library);
  if (djSongs.length === 0) return;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(show.name)} - DJ List</title>
  <style>
    ${houseFontFaces()}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${SANS}; padding: 40px; color: #141413; background: #fff; font-size: 13px; }
    h1 { font-family: ${SERIF}; font-size: 28px; font-weight: 500; line-height: 1.1; color: #141413; margin-bottom: 8px; }
    .meta { color: #55524c; margin-bottom: 4px; font-size: 13px; }
    .meta strong { color: #141413; font-weight: 600; }
    h2 { font-family: ${SERIF}; font-size: 20px; font-weight: 500; color: #141413; border-bottom: 1px solid #c9c5bd; padding-bottom: 6px; margin: 26px 0 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    /* The same header as the runsheet's: tracked capitals over an ink rule,
       with nothing for a printer to strip. */
    th { background: none; color: #141413; padding: 8px 12px 6px; text-align: left; font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; border-bottom: 1px solid #141413; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td { padding: 7px 12px; border-bottom: 1px solid #e4e1da; font-size: 13px; }
    tr:last-child td { border-bottom: none; }
  </style>
</head>
<body>
  <h1>DJ Music List</h1>
  <div class="meta"><strong>Show:</strong> ${esc(show.name)}</div>
  ${show.date ? `<div class="meta"><strong>Date:</strong> ${esc(show.date)}</div>` : ""}
  ${show.venueName ? `<div class="meta"><strong>Venue:</strong> ${esc(show.venueName)}</div>` : ""}

  <h2>Song List</h2>
  <table>
    <tr><th>#</th><th>Title</th><th>Artist</th><th>Notes</th></tr>
    ${djSongs.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.title)}</td><td>${esc(s.artist)}</td><td>${esc(s.notes)}</td></tr>`).join("")}
  </table>
</body>
</html>`;

  openPrintable(html);
}
