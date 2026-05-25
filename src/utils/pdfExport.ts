import type {
  Show,
  AppSettings,
  Performer,
  Artist,
  ScheduleItem,
  Host,
  DJSong,
  StaffMember,
  Vendor,
  Expense,
  ShowFile,
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
    td { padding: 7px 12px; border-bottom: 1px solid #E5E7EB; font-size: 13px; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .total-row td { font-weight: bold; background: #F3F4F6; }
    .rules-box { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 14px; margin-top: 10px; white-space: pre-wrap; font-size: 13px; }
    .section-empty { color: #9CA3AF; font-style: italic; font-size: 12px; padding: 6px 0; }
    .photo-thumb { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 8px; }
    .flyer-img { max-width: 320px; height: auto; display: block; margin: 10px 0 16px; border-radius: 8px; border: 1px solid #E5E7EB; }
    .file-img { max-width: 100%; height: auto; display: block; margin: 8px 0; border-radius: 4px; border: 1px solid #E5E7EB; page-break-inside: avoid; }
    .file-entry { margin-bottom: 18px; padding-bottom: 10px; border-bottom: 1px solid #E5E7EB; page-break-inside: avoid; }
    .file-entry:last-child { border-bottom: none; }
    .file-name { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
    .file-meta { color: #6B7280; font-size: 11px; margin-bottom: 4px; }
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
  </style>
</head>
<body>
  <div class="brand">${esc(settings.brandName)}</div>
  ${settings.producers.length > 0 ? `<div class="producers">Producers: ${settings.producers.map((p) => `${esc(p.name)} (${esc(p.role)})`).join(", ")}</div>` : ""}

  ${show.flyer ? `<img class="flyer-img" src="${show.flyer}" alt="Show Flyer" />` : ""}

  <h1>${esc(show.name)}</h1>
  ${show.date ? `<div class="meta"><strong>Date:</strong> ${esc(show.date)}</div>` : ""}
  ${show.time ? `<div class="meta"><strong>Time:</strong> ${esc(show.time)}</div>` : ""}
  ${show.venueName ? `<div class="meta"><strong>Venue:</strong> ${esc(show.venueName)}</div>` : ""}
  ${show.location ? `<div class="meta"><strong>Location:</strong> ${esc(show.location)}</div>` : ""}
  ${show.ticketLink ? `<div class="meta"><strong>Ticket Link:</strong> <a href="${esc(show.ticketLink)}">${esc(show.ticketLink)}</a></div>` : ""}
  ${show.status ? `<div class="meta"><strong>Status:</strong> ${esc(show.status)}</div>` : ""}
  ${show.videoPerson ? `<div class="meta"><strong>Video Person:</strong> ${esc(show.videoPerson)}${show.videoPayment ? ` — Payment: ${formatCurrency(Number(show.videoPayment))}` : ""}</div>` : ""}

  ${
    show.performers.length > 0
      ? `
  <h2>Performers</h2>
  <table>
    <tr><th>#</th><th>Name</th><th>Social Media</th><th>Walk-On Music</th><th>Walk-On Timestamp</th><th>Credits</th><th>Locked In</th></tr>
    ${show.performers.map((p: Performer, i: number) => `
    <tr>
      <td>${i + 1}</td>
      <td>${p.photo ? `<img class="photo-thumb" src="${p.photo}" />` : ""}${esc(p.name)}</td>
      <td>${esc(p.socialMedia)}</td>
      <td>${p.walkOnMusicName ? esc(p.walkOnMusicName) : "—"}</td>
      <td>${esc(p.walkOnMusicTimestamp)}</td>
      <td>${esc(p.credits)}</td>
      <td>${p.lockedIn ? '<span class="badge badge--green">✓ Yes</span>' : "No"}</td>
    </tr>`).join("")}
  </table>`
      : ""
  }

  ${
    (show.artists?.length ?? 0) > 0
      ? `
  <h2>Artists</h2>
  <table>
    <tr><th>#</th><th>Name</th><th>Type</th><th>Walk-On Music</th><th>File</th></tr>
    ${show.artists.map((a: Artist, i: number) => `
    <tr>
      <td>${i + 1}</td>
      <td>${a.photo ? `<img class="photo-thumb" src="${a.photo}" />` : ""}${esc(a.name)}</td>
      <td>${esc(a.artistType)}</td>
      <td>${a.walkOnMusicName ? esc(a.walkOnMusicName) : "—"}</td>
      <td>${a.fileName ? esc(a.fileName) : "—"}</td>
    </tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.scheduleImage
      ? `
  <h2>Schedule &amp; Timing</h2>
  <img src="${show.scheduleImage}" style="max-width: 100%; height: auto; margin-bottom: 10px;" alt="Schedule" />`
      : show.schedule.length > 0
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
    (show.files?.length ?? 0) > 0
      ? `
  <h2>Attached Files</h2>
  ${(show.files as ShowFile[]).map((f: ShowFile) => `
  <div class="file-entry">
    <div class="file-name">${esc(f.name)}</div>
    <div class="file-meta">Type: ${esc(f.fileType)} &nbsp;·&nbsp; Uploaded: ${f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString() : "—"}${f.notes ? ` &nbsp;·&nbsp; ${esc(f.notes)}` : ""}</div>
    ${f.fileType.startsWith("image/") ? `<img class="file-img" src="${f.fileData}" alt="${esc(f.name)}" />` : f.fileType === "application/pdf" ? `<embed src="${f.fileData}" type="application/pdf" style="width:100%;height:1100px;display:block;margin:8px 0;border:1px solid #E5E7EB;border-radius:4px;" />` : ""}
  </div>`).join("")}`
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
