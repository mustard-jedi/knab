// Pure date and budget-period helpers shared by the server and the web app.
// Dates are always 'YYYY-MM-DD' strings; period labels are 'YYYY-MM'.
// A period labelled 2026-01 with cutoff day 23 runs 2026-01-23 .. 2026-02-22.

const pad = (n) => String(n).padStart(2, '0');

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatDate(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return { y, m, d };
}

export function isValidDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const { y, m, d } = parseDate(str);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function todayStr(now = new Date()) {
  return formatDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(str, n) {
  const { y, m, d } = parseDate(str);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return formatDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function formatLabel(year, month) {
  return `${year}-${pad(month)}`;
}

export function shiftLabel(label, n) {
  const [y, m] = label.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return formatLabel(Math.floor(idx / 12), (idx % 12) + 1);
}

// First day of the period with this label. A cutoff past the end of a short
// month clamps to that month's last day (cutoff 31 -> Feb 28/29).
export function periodStart(label, cutoffDay) {
  const [y, m] = label.split('-').map(Number);
  return formatDate(y, m, Math.min(cutoffDay, daysInMonth(y, m)));
}

export function periodByLabel(label, cutoffDay) {
  const start = periodStart(label, cutoffDay);
  const end = addDays(periodStart(shiftLabel(label, 1), cutoffDay), -1);
  return { label, start, end };
}

export function periodFor(dateStr, cutoffDay) {
  const { y, m } = parseDate(dateStr);
  const label = formatLabel(y, m);
  // String comparison is safe for zero-padded ISO dates.
  if (dateStr >= periodStart(label, cutoffDay)) return periodByLabel(label, cutoffDay);
  return periodByLabel(shiftLabel(label, -1), cutoffDay);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(str, withYear = false) {
  const { y, m, d } = parseDate(str);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`;
}

export function periodTitle(period) {
  const sameYear = period.start.slice(0, 4) === period.end.slice(0, 4);
  return `${shortDate(period.start, !sameYear)} – ${shortDate(period.end, true)}`;
}

// Next occurrence of a recurring schedule. anchorDay keeps monthly schedules
// from drifting (31st -> Feb 28 -> Mar 31, not Mar 28).
export function nextOccurrence(dateStr, frequency, anchorDay) {
  const { y, m, d } = parseDate(dateStr);
  switch (frequency) {
    case 'weekly':
      return addDays(dateStr, 7);
    case 'biweekly':
      return addDays(dateStr, 14);
    case 'monthly': {
      const idx = y * 12 + m;
      const ny = Math.floor(idx / 12);
      const nm = (idx % 12) + 1;
      return formatDate(ny, nm, Math.min(anchorDay || d, daysInMonth(ny, nm)));
    }
    case 'yearly':
      return formatDate(y + 1, m, Math.min(anchorDay || d, daysInMonth(y + 1, m)));
    default:
      throw new Error(`Unknown frequency: ${frequency}`);
  }
}
