import type {
  Show,
  AppSettings,
  Performer,
  ScheduleItem,
  Host,
  DJSong,
  StaffMember,
  Expense,
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

export function exportShowToPDF(show: Show, settings: AppSettings): void {
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
    td { padding: 7px 12px; border-bottom: 1px solid #E5E7EB; font-size: 13px; }
    tr:last-child td { border-bottom: none; }
    .total-row td { font-weight: bold; background: #F3F4F6; }
    .rules-box { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 14px; margin-top: 10px; white-space: pre-wrap; font-size: 13px; }
    .section-empty { color: #9CA3AF; font-style: italic; font-size: 12px; padding: 6px 0; }
    .photo-thumb { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 8px; }
  </style>
</head>
<body>
  <div class="brand">${esc(settings.brandName)}</div>
  ${settings.producerNames ? `<div class="producers">Producers: ${esc(settings.producerNames)}</div>` : ""}

  <h1>${esc(show.name)}</h1>
  ${show.date ? `<div class="meta"><strong>Date:</strong> ${esc(show.date)}</div>` : ""}
  ${show.time ? `<div class="meta"><strong>Time:</strong> ${esc(show.time)}</div>` : ""}
  ${show.venueName ? `<div class="meta"><strong>Venue:</strong> ${esc(show.venueName)}</div>` : ""}
  ${show.location ? `<div class="meta"><strong>Location:</strong> ${esc(show.location)}</div>` : ""}

  ${
    show.performers.length > 0
      ? `
  <h2>Performers</h2>
  <table>
    <tr><th>#</th><th>Name</th><th>Walk-On Music</th></tr>
    ${show.performers.map((p: Performer, i: number) => `<tr><td>${i + 1}</td><td>${p.photo ? `<img class="photo-thumb" src="${p.photo}" />` : ""}${esc(p.name)}</td><td>${p.walkOnMusicName ? esc(p.walkOnMusicName) : "—"}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    (show.artists?.length ?? 0) > 0
      ? `
  <h2>Artists</h2>
  <table>
    <tr><th>#</th><th>Name</th><th>Walk-On Music</th></tr>
    ${show.artists.map((a: Performer, i: number) => `<tr><td>${i + 1}</td><td>${a.photo ? `<img class="photo-thumb" src="${a.photo}" />` : ""}${esc(a.name)}</td><td>${a.walkOnMusicName ? esc(a.walkOnMusicName) : "—"}</td></tr>`).join("")}
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
    ${show.hosts.map((h: Host) => `<tr><td>${h.photo ? `<img class="photo-thumb" src="${h.photo}" />` : ""}${esc(h.name)}</td><td>${h.isHosting ? "✓ Yes" : "No"}</td><td>${esc(h.notes)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.djSongs.length > 0
      ? `
  <h2>DJ Music List</h2>
  <table>
    <tr><th>#</th><th>Title</th><th>Artist</th><th>Notes</th></tr>
    ${show.djSongs.map((s: DJSong, i: number) => `<tr><td>${i + 1}</td><td>${esc(s.title)}</td><td>${esc(s.artist)}</td><td>${esc(s.notes)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.staff.length > 0
      ? `
  <h2>Staff &amp; Crew</h2>
  <table>
    <tr><th>Role</th><th>Person</th></tr>
    ${show.staff.map((s: StaffMember) => `<tr><td>${esc(s.role)}</td><td>${esc(s.personName)}</td></tr>`).join("")}
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
    settings.rules
      ? `
  <h2>Rules</h2>
  <div class="rules-box">${esc(settings.rules)}</div>`
      : ""
  }

</body>
</html>`;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 300);
  }
}

export function exportDJListToPDF(show: Show): void {
  if (show.djSongs.length === 0) return;

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
    ${show.djSongs.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.title)}</td><td>${esc(s.artist)}</td><td>${esc(s.notes)}</td></tr>`).join("")}
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
