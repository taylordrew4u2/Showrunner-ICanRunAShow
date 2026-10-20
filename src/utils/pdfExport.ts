import { buildIntroCards, type IntroCard } from "./introCards";
import { showDJSongs } from "./musicLibrary";
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
  return `$${amount.toFixed(2)}`;
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

/** Only drawn when it has something to say — an empty foot is a stray rule. */
function renderCardFoot(card: IntroCard): string {
  const handle = card.social ? esc(card.social) : card.kind === "artist" ? "Artist" : "";
  // A surprise guest's card says so first, where the host's thumb is.
  const right = card.surprise ? [SURPRISE_GUEST_LABEL, handle].filter(Boolean).join(" · ") : handle;
  if (!card.walkOn && !right) return "";
  return `
        <div class="card__foot">
          <span class="card__walkon">${card.walkOn ? `♪ ${esc(card.walkOn)}` : ""}</span>
          <span class="card__kind">${right}</span>
        </div>`;
}

function renderIntroCard(card: IntroCard): string {
  const foot = renderCardFoot(card);
  return `
      <div class="card${foot ? " card--foot" : ""}">
        <div class="card__num">${card.order}</div>
        <div class="card__name">${esc(card.name)}</div>
        <div class="card__credits${card.credits ? "" : " card__credits--none"}">${
          card.credits ? esc(card.credits) : "No credits on file"
        }</div>
        ${foot}
      </div>`;
}

export function exportShowToPDF(show: Show, settings: AppSettings): void {
  // The same list the show runs on: its own songs plus the music library.
  const djSongs = showDJSongs(show, settings.musicLibrary ?? []);
  const totalExpenses = show.expenses.reduce(
    (sum, e) => sum + (Number(e.cost) || 0),
    0,
  );

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
      padding: 14px 16px 12px;
      border: 1px solid #c9c5bd;
      border-radius: 0;
      background: #fff;
      /* The faint ruling. Printers strip backgrounds by default, hence the
         print-color-adjust below — without it these cards come out blank. */
      background-image: repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent 27px,
        #ebe8e2 27px,
        #ebe8e2 28px
      );
      background-position: 0 46px;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
      /* A column, so the credits can be given a box that ends where the foot
         begins; see .card__credits. */
      display: flex;
      flex-direction: column;
    }
    /* Room for the foot, which is pinned to the bottom of the card. */
    .card--foot { padding-bottom: 36px; }
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
    }
    .card__credits--none { color: #6b675f; font-style: italic; }
    .card__foot {
      position: absolute;
      left: 16px;
      right: 16px;
      bottom: 10px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 11px;
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
      ${show.recap.attendance != null ? `<div class="recap-stat"><div class="recap-stat__label">Attendance</div><div class="recap-stat__value">${show.recap.attendance}</div></div>` : ""}
      ${show.recap.merchSales != null ? `<div class="recap-stat"><div class="recap-stat__label">Merch Sales</div><div class="recap-stat__value">${formatCurrency(Number(show.recap.merchSales))}</div></div>` : ""}
      ${show.recap.profitLoss != null ? `<div class="recap-stat"><div class="recap-stat__label">Profit / Loss</div><div class="recap-stat__value">${formatCurrency(Number(show.recap.profitLoss))}</div></div>` : ""}
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
