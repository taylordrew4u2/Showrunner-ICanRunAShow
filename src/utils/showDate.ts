/**
 * Parse a show's date string as a LOCAL date. Show dates are stored as
 * "YYYY-MM-DD"; `new Date("YYYY-MM-DD")` parses as UTC midnight, which shifts
 * the displayed day for users west of Greenwich — so split it manually.
 */
export function parseShowDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/** Local-timezone "YYYY-MM-DD" key for grouping shows by day. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
