import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Show, AppSettings } from "./types";

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

export async function exportShowToPDF(
  show: Show,
  settings: AppSettings,
): Promise<void> {
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
    body { font-family: Arial, sans-serif; padding: 30px; color: #1F2937; font-size: 13px; }
    .brand { color: #6B46C1; font-size: 22px; font-weight: bold; margin-bottom: 4px; }
    .producers { color: #4B5563; margin-bottom: 16px; }
    h1 { font-size: 20px; color: #1F2937; margin-bottom: 8px; }
    .meta { color: #4B5563; margin-bottom: 4px; }
    h2 { font-size: 15px; color: #6B46C1; border-bottom: 2px solid #6B46C1; padding-bottom: 4px; margin: 20px 0 8px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { background: #6B46C1; color: #fff; padding: 7px 10px; text-align: left; font-size: 12px; }
    td { padding: 6px 10px; border-bottom: 1px solid #E5E7EB; }
    tr:last-child td { border-bottom: none; }
    .total-row td { font-weight: bold; background: #F3F4F6; }
    .rules-box { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 12px; margin-top: 8px; white-space: pre-wrap; }
    .section-empty { color: #9CA3AF; font-style: italic; font-size: 12px; padding: 4px 0; }
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
    show.schedule.length > 0
      ? `
  <h2>Schedule &amp; Timing</h2>
  <table>
    <tr><th>Time</th><th>Event</th></tr>
    ${show.schedule.map((s) => `<tr><td>${esc(s.time)}</td><td>${esc(s.description)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.performers.length > 0
      ? `
  <h2>Performers</h2>
  <table>
    <tr><th>#</th><th>Name</th><th>Walk-On Music</th></tr>
    ${show.performers.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.walkOnMusic ? "✓ Assigned" : "—"}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    (show.artists?.length ?? 0) > 0
      ? `
  <h2>Artists</h2>
  <table>
    <tr><th>#</th><th>Name</th><th>Walk-On Music</th></tr>
    ${show.artists.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.name)}</td><td>${a.walkOnMusic ? "✓ Assigned" : "—"}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.hosts.length > 0
      ? `
  <h2>Hosts</h2>
  <table>
    <tr><th>Name</th><th>Hosting</th><th>Notes</th></tr>
    ${show.hosts.map((h) => `<tr><td>${esc(h.name)}</td><td>${h.isHosting ? "✓ Yes" : "No"}</td><td>${esc(h.notes)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.djSongs.length > 0
      ? `
  <h2>DJ Music List</h2>
  <table>
    <tr><th>#</th><th>Title</th><th>Artist</th><th>Notes</th></tr>
    ${show.djSongs.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.title)}</td><td>${esc(s.artist)}</td><td>${esc(s.notes)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.staff.length > 0
      ? `
  <h2>Staff &amp; Crew</h2>
  <table>
    <tr><th>Role</th><th>Person</th></tr>
    ${show.staff.map((s) => `<tr><td>${esc(s.role)}</td><td>${esc(s.personName)}</td></tr>`).join("")}
  </table>`
      : ""
  }

  ${
    show.expenses.length > 0
      ? `
  <h2>Itemized Expenses</h2>
  <table>
    <tr><th>Category</th><th>Item</th><th>Cost</th><th>Date</th><th>Notes</th></tr>
    ${show.expenses.map((e) => `<tr><td>${esc(e.category)}</td><td>${esc(e.itemName)}</td><td>${formatCurrency(Number(e.cost) || 0)}</td><td>${esc(e.date)}</td><td>${esc(e.notes)}</td></tr>`).join("")}
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

  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      dialogTitle: `${show.name} — Show Details`,
      UTI: "com.adobe.pdf",
    });
  }
}

export async function exportDJListAsText(show: Show): Promise<void> {
  if (show.djSongs.length === 0) return;

  const lines = [
    `DJ MUSIC LIST`,
    `Show: ${show.name}`,
    show.date ? `Date: ${show.date}` : "",
    show.venueName ? `Venue: ${show.venueName}` : "",
    "",
    "─".repeat(40),
    "",
    ...show.djSongs.map(
      (s, i) =>
        `${String(i + 1).padStart(2, " ")}. "${s.title}" — ${s.artist}${s.notes ? `\n     Note: ${s.notes}` : ""}`,
    ),
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const html = `<html><body><pre style="font-family: monospace; padding: 20px;">${esc(lines)}</pre></body></html>`;
  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      dialogTitle: "DJ Music List",
      UTI: "com.adobe.pdf",
    });
  }
}
