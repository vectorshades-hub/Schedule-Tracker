/**
 * Ported verbatim from app.py's compute_status()/resolve_complete_status()/
 * parse_date()/due_from_sub()/fmt_date()/fmt_datetime(). This is the single
 * source of truth used by both the records API and the daily backup job
 * (the original had this logic duplicated between app.py and
 * daily_backup.py — that duplication is intentionally removed here).
 */
const env = require("../config/env");

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Normalizes any Date/string to a UTC-midnight Date representing just the calendar day, or null. */
function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) {
    if (isNaN(s.getTime())) return null;
    return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  }
  const str = String(s).trim().slice(0, 10);
  // Try MM-DD-YYYY, YYYY-MM-DD, DD-MM-YYYY (same fallback order as the original)
  let m;
  if ((m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  if ((m = str.match(/^(\d{2})-(\d{2})-(\d{4})$/))) {
    // Ambiguous MM-DD-YYYY vs DD-MM-YYYY — mirror the original's first-match-wins order (MM-DD-YYYY first)
    const mm = +m[1],
      dd = +m[2],
      yyyy = +m[3];
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return new Date(Date.UTC(yyyy, mm - 1, dd));
    }
  }
  return null;
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function daysBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

/** Submission date + 7 days (default due date when none supplied). */
function dueFromSub(subDate) {
  const d = parseDate(subDate);
  if (!d) return null;
  return new Date(d.getTime() + 7 * 86400000);
}

function fmtDate(d) {
  const parsed = parseDate(d);
  if (!parsed) return "";
  return `${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())}-${parsed.getUTCFullYear()}`;
}

function fmtDateOnlyISO(d) {
  const parsed = parseDate(d);
  if (!parsed) return "";
  return `${parsed.getUTCFullYear()}-${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())}`;
}

function fmtDateTime(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return (
    `${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}-${dt.getFullYear()} ` +
    `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`
  );
}

/**
 * Returns { status, tag }. `stored` is the raw stored status string on the
 * record (may already say "COMPLETED..." or "ON HOLD"); otherwise the status
 * is computed live from the due date.
 */
function computeStatus(dueDate, stored = "") {
  const storedUpper = String(stored || "").toUpperCase();
  if (stored && storedUpper.startsWith("COMPLETED")) {
    const tag = storedUpper.includes("OVERDUE") ? "completed_overdue" : "completed";
    return { status: String(stored), tag };
  }
  if (stored && storedUpper === "ON HOLD") {
    return { status: "ON HOLD", tag: "hold" };
  }
  const due = parseDate(dueDate);
  if (!due) {
    return { status: "NO DUE DATE", tag: "nodue" };
  }
  const delta = daysBetween(due, todayUTC());
  if (delta < 0) return { status: `OVERDUE (${Math.abs(delta)}d)`, tag: "overdue" };
  if (delta === 0) return { status: "DUE TODAY", tag: "duesoon" };
  if (delta <= env.dueSoonDays) return { status: `DUE SOON (${delta}d)`, tag: "duesoon" };
  return { status: `ON TRACK (${delta}d)`, tag: "ontrack" };
}

/** Status string to store when a record is marked COMPLETED. */
function resolveCompleteStatus(dueDate) {
  const due = parseDate(dueDate);
  if (due) {
    const today = todayUTC();
    if (due.getTime() < today.getTime()) {
      const days = daysBetween(today, due);
      return { status: `COMPLETED (OVERDUE ${days}d)`, tag: "completed_overdue" };
    }
  }
  return { status: "COMPLETED", tag: "completed" };
}

/**
 * The "completed between midnight and 3AM counts as the previous day"
 * quirk from app.py's add/update routes.
 */
function completedAtNow() {
  const now = new Date();
  if (now.getHours() < 3) {
    const shifted = new Date(now.getTime() - 86400000);
    shifted.setHours(23, 59, 0, 0);
    return shifted;
  }
  return now;
}

module.exports = {
  parseDate,
  todayUTC,
  daysBetween,
  dueFromSub,
  fmtDate,
  fmtDateOnlyISO,
  fmtDateTime,
  computeStatus,
  resolveCompleteStatus,
  completedAtNow,
};
