import { buildIntroCards, type IntroCard } from "./introCards";
import { showDJSongs } from "./musicLibrary";
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
  const right = card.social ? esc(card.social) : card.kind === "artist" ? "Artist" : "";
  if (!card.walkOn && !right) return "";
  return `
        <div class="card__foot">
          <span class="card__walkon">${card.walkOn ? `♪ ${esc(card.walkOn)}` : ""}</span>
          <span class="card__kind">${right}</span>
        </div>`;
}

function renderIntroCard(card: IntroCard): string {
  return `
      <div class="card">
        <div class="card__num">${card.order}</div>
        <div class="card__name">${esc(card.name)}</div>
        <div class="card__credits${card.credits ? "" : " card__credits--none"}">${
          card.credits ? esc(card.credits) : "No credits on file"
        }</div>
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

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(show.name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1F2937; font-size: 13px; }
    .brand { color: #6B46C1; font-size: 24px; font-weight: bold; margin-bottom: 4px; }
    .producers { color: #4B5563; margin-bottom: 16px; font-size: 14px; }
    h1 { font-size: 22px; color: #1F2937; margin-bottom: 8px; }
    .meta { color: #4B5563; margin-bottom: 4px; font-size: 14px; }
    h2 { font-size: 16px; color: #6B46C1; border-bottom: 2px solid #6B46C1; padding-bottom: 6px; margin: 24px 0 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th { background: #6B46C1; color: #fff; padding: 8px 12px; text-align: left; font-size: 12px; }
    td { padding: 7px 12px; border-bottom: 1px solid #E5E7EB; font-size: 13px; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .total-row td { font-weight: bold; background: #F3F4F6; }
    .rules-box { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 14px; margin-top: 10px; white-space: pre-wrap; font-size: 13px; }
    .section-empty { color: #9CA3AF; font-style: italic; font-size: 12px; padding: 6px 0; }
    .badge { display: inline-block; background: #EDE9FE; color: #5B21B6; border-radius: 4px; padding: 2px 7px; font-size: 11px; font-weight: 600; margin-left: 6px; }
    .badge--green { background: #D1FAE5; color: #065F46; }
    .todo-item { padding: 4px 0; border-bottom: 1px solid #F3F4F6; font-size: 13px; }
    .todo-item:last-child { border-bottom: none; }
    .todo-done { text-decoration: line-through; color: #9CA3AF; }
    .recap-box { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 14px; margin-top: 10px; }
    .recap-row { display: flex; gap: 32px; flex-wrap: wrap; margin-bottom: 10px; }
    .recap-stat { min-width: 120px; }
    .recap-stat__label { font-size: 11px; color: #6B7280; }
    .recap-stat__value { font-size: 18px; font-weight: 700; color: #1F2937; }
    .recap-notes { margin-top: 10px; font-size: 13px; white-space: pre-wrap; }

    /* ── Intro cards ──────────────────────────────────────────────────
       The stack the host reads from at the mic. Printed to look like the
       index cards they replace — ruled lines, a red line under the name —
       because that is the thing a host already knows how to hold and shuffle.

       Two to a row and a fixed height so a sheet cuts into even cards, and
       page-break-inside so none of them ever straddles a fold. */
    .cards-page { page-break-before: always; }
    .cards-note { color: #6B7280; font-size: 12px; margin: 0 0 14px; }
    .cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .card {
      position: relative;
      height: 2.5in;
      padding: 14px 16px 12px;
      border: 1px solid #C7CBD1;
      border-radius: 5px;
      background: #FFFDF8;
      /* The faint ruling. Printers strip backgrounds by default, hence the
         print-color-adjust below — without it these cards come out blank. */
      background-image: repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent 27px,
        #DCE6F1 27px,
        #DCE6F1 28px
      );
      background-position: 0 46px;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .card__num {
      position: absolute;
      top: 10px;
      right: 12px;
      font-size: 11px;
      font-weight: 700;
      color: #9CA3AF;
    }
    .card__name {
      font-size: 21px;
      font-weight: 700;
      line-height: 1.15;
      color: #111827;
      padding-bottom: 6px;
      margin-bottom: 8px;
      border-bottom: 2px solid #D93025;
      padding-right: 28px;
      word-break: break-word;
    }
    .card__credits {
      font-size: 13px;
      line-height: 28px;
      color: #1F2937;
      word-break: break-word;
    }
    .card__credits--none { color: #9CA3AF; font-style: italic; }
    .card__foot {
      position: absolute;
      left: 16px;
      right: 16px;
      bottom: 10px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 11px;
      color: #4B5563;
      border-top: 1px solid #E5E7EB;
      padding-top: 6px;
    }
    .card__walkon { font-weight: 600; }
    .card__kind { color: #9CA3AF; white-space: nowrap; }

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
      <td>${esc(p.name)}</td>
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
    ${show.recap.performerNotes ? `<div class="recap-notes"><strong>Performer Notes:</strong>\n${esc(show.recap.performerNotes)}</div>` : ""}
    ${show.recap.improvementNotes ? `<div class="recap-notes" style="margin-top:8px;"><strong>Improvement Notes:</strong>\n${esc(show.recap.improvementNotes)}</div>` : ""}
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

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 300);
  }
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1F2937; font-size: 13px; }
    h1 { font-size: 20px; color: #1F2937; margin-bottom: 8px; }
    .meta { color: #4B5563; margin-bottom: 4px; font-size: 13px; }
    h2 { font-size: 15px; color: #0F766E; border-bottom: 2px solid #0F766E; padding-bottom: 6px; margin: 24px 0 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th { background: #0F766E; color: #fff; padding: 8px 12px; text-align: left; font-size: 12px; }
    td { padding: 7px 12px; border-bottom: 1px solid #E5E7EB; font-size: 13px; }
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

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 300);
  }
}
