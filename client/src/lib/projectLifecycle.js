/**
 * Derives a 4-stage "project lifecycle" (Project Received → OFA – Issued for
 * Approval → Fabrication → Completed) purely from a project's existing
 * submission records — there is no separate Project entity in this app, so
 * every field here is inferred from the records that share a `project` name:
 *
 *  - "Project Received"        = the earliest record's created-at timestamp.
 *  - "OFA – Issued for Approval" = reached once the project has any
 *                                 submission whose type is OFA, REAPPROVAL,
 *                                 or FOR REVIEW (see OFA_TYPES) — dated and
 *                                 badged by the most recent such submission.
 *  - "Fabrication"              = reached once the project has any
 *                                 submission whose type is FAB, FIELD USE, or
 *                                 REVISION (see FAB_TYPES) — dated and
 *                                 badged by the most recent such submission.
 *  - "Completed"                = reached only once every record for the
 *                                 project has a completed status tag (its
 *                                 real COMPLETED status, set from the
 *                                 record's own Edit panel).
 *
 * None of the 4 stages' own "done" checkmark is computed here, though —
 * that's a fully manual signoff per stage (`completed`/`ofaCompleted`/
 * `fabCompleted` on the Project document itself, each with its own
 * `*CompletedAt` timestamp; see server/src/routes/projects.js action=
 * mark_completed/mark_ofa_completed/mark_fab_completed), passed into
 * SubmissionOverview.js as props and applied on top of the `reached`
 * booleans below. Each one is cleared again server-side the moment a
 * fresh submission is added to the project (POST /api/records) — a new
 * OFA/REAPPROVAL/FOR REVIEW submission clears `ofaCompleted`, a new FAB/
 * FIELD USE/REVISION one clears `fabCompleted`, and any new submission
 * clears `completed` — so the signoffs can never accidentally survive
 * past a project that isn't actually finished. A record also still
 * carries its own independent `type_completed`/`type_completed_at` (set
 * via the "more info" popup's "Mark Stage Complete") — that's just
 * per-submission bookkeeping now, unrelated to these stage-level signoffs.
 */

export const OFA_TYPES = new Set(["OFA", "REAPPROVAL", "FOR REVIEW"]);
export const FAB_TYPES = new Set(["FAB", "FIELD USE", "REVISION"]);

const TYPE_LABELS = {
  OFA: "OFA – Issued for Approval",
  FAB: "FAB – Fabrication",
  REAPPROVAL: "Reapproval",
  REVISION: "Revision",
  "FOR REVIEW": "For Review",
  "FIELD USE": "Field Use",
};

export function typeLabel(type) {
  return TYPE_LABELS[String(type || "").toUpperCase()] || type || "Submission";
}

export function parseDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function daysBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

/** Strips the time-of-day (UTC) so a same-day "completed at 2pm" doesn't get
 * rounded up into an extra day when diffed against a date-only value. */
function toDateOnly(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function fmtDateLong(d) {
  const parsed = parseDate(d);
  if (!parsed) return "";
  return parsed.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

/** Same as fmtDateLong, plus a time-of-day — for timestamps where *when*
 * during the day matters (e.g. a project's completedAt signoff). */
export function fmtDateTimeLong(d) {
  const parsed = parseDate(d);
  if (!parsed) return "";
  return parsed.toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function mostCommonValue(values) {
  const counts = {};
  let best = "";
  let bestCount = 0;
  for (const v of values) {
    if (!v) continue;
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > bestCount) {
      best = v;
      bestCount = counts[v];
    }
  }
  return best;
}

/** Most recently submitted record overall (by sub date, falling back to created-at),
 * optionally restricted to records whose submission_type falls in `typeSet`. */
function latestSubmission(records, typeSet = null) {
  const matches = records
    .filter((r) => !typeSet || typeSet.has(String(r.submission_type || "").toUpperCase()))
    .map((r) => ({ r, d: parseDate(r.sub_date_raw) || parseDate(r.created_at_raw) }))
    .filter((x) => x.d);
  if (!matches.length) return null;
  matches.sort((a, b) => b.d - a.d);
  return matches[0];
}

/** Builds one of the two middle (OFA / Fabrication) stages from its latest
 * matching record (`match`) — used for the stage's own date/record.
 * Whether the stage itself is "done" is NOT decided here; that's the
 * manual `ofaCompleted`/`fabCompleted` project-level signoff, applied by
 * the caller (SubmissionOverview.js). `groupRecords` is currently unused
 * here (kept as a parameter since callers already have it on hand — e.g.
 * if a future "X of Y submissions completed" indicator wants it). */
function buildTypeStage(key, label, groupRecords, match) {
  return {
    key,
    label,
    date: match ? match.d : null,
    reached: !!match,
    submissionType: match ? match.r.submission_type : null,
    record: match ? match.r : null,
  };
}

/**
 * Groups a project's records whose submission_type falls in `typeSet` into
 * one entry per distinct submission date (falling back to created-at when
 * sub_date is missing, then to an "unknown date" bucket sorted last) —
 * used to plot one dot per date along a lifecycle segment, with every
 * same-day submission bundled into that dot's own `records` list so a
 * click can show all of them together.
 * @returns {Array<{ date: Date|null, records: Array }>} sorted chronologically
 */
export function clusterByDate(records, typeSet) {
  const groups = new Map();
  for (const r of records) {
    if (!typeSet.has(String(r.submission_type || "").toUpperCase())) continue;
    const d = parseDate(r.sub_date_raw) || parseDate(r.created_at_raw);
    const key = d ? toDateOnly(d).toISOString() : "unknown";
    if (!groups.has(key)) groups.set(key, { date: d, records: [] });
    groups.get(key).records.push(r);
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date - b.date;
  });
}

/**
 * @param {Array} records - rows shaped like rowToRecord() output (id, project,
 *   submission_type, sub_date_raw, created_at_raw, completed_at, tag, status, ...)
 * @returns {null | { stages, currentIndex, gaps, avgPct }}
 */
export function computeProjectLifecycle(records) {
  if (!records || !records.length) return null;

  const withCreated = records
    .map((r) => ({ r, d: parseDate(r.created_at_raw) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d - b.d);
  const received = withCreated[0] || null;

  const ofaGroup = records.filter((r) => OFA_TYPES.has(String(r.submission_type || "").toUpperCase()));
  const fabGroup = records.filter((r) => FAB_TYPES.has(String(r.submission_type || "").toUpperCase()));
  const ofaMatch = latestSubmission(ofaGroup);
  const fabMatch = latestSubmission(fabGroup);

  const allCompleted = records.every((r) => (r.tag || "").startsWith("completed"));
  const completedDates = records.map((r) => parseDate(r.completed_at)).filter(Boolean);
  const completedDate =
    allCompleted && completedDates.length ? new Date(Math.max(...completedDates.map((d) => d.getTime()))) : null;

  const stages = [
    {
      key: "received",
      label: "Project Received",
      date: received ? received.d : null,
      reached: !!received,
    },
    buildTypeStage("ofa", "OFA – Issued for Approval", ofaGroup, ofaMatch),
    buildTypeStage("fabrication", "Fabrication", fabGroup, fabMatch),
    {
      key: "completed",
      label: "Completed",
      date: completedDate,
      reached: allCompleted,
    },
  ];

  let currentIndex = 1;
  for (let i = stages.length; i >= 1; i--) {
    if (stages[i - 1].reached) {
      currentIndex = i;
      break;
    }
  }

  const gaps = [];
  for (let i = 0; i < stages.length - 1; i++) {
    const a = stages[i].date;
    const b = stages[i + 1].date;
    gaps.push(a && b ? daysBetween(b, a) : null);
  }

  const totalPct = records.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0);
  const avgPct = Math.round(totalPct / records.length);

  return { stages, currentIndex, gaps, avgPct };
}

/**
 * Recent-first feed for the Activity panel, merged from every source the
 * submission detail page loads:
 *  - `records`      — this submission itself: created, stage marked complete
 *                     (typeCompleted), submission completed, put on hold.
 *  - `changeOrders` / `rfis` — created + updated (any edit, approval
 *    decision, billed toggle, or "mark answered" all bump `updated_at`, so
 *    a single "updated" event covers all of them without extra plumbing).
 *  - `deletedEvents` — from GET /api/activity-log/project (hooks/useActivityLog.js):
 *    the only case the documents above can't self-report, since a deleted
 *    Change Order/RFI has no fields left to read a timestamp off of.
 */
export function buildCombinedActivity({ records = [], changeOrders = [], rfis = [], deletedEvents = [] }, limit = 10) {
  const events = [];

  for (const r of records) {
    const created = parseDate(r.created_at_raw);
    if (created) events.push({ ts: created, title: `Submission #${r.id} (${r.submission_type}) created`, user: r.created_by || "—" });
    const typeCompletedAt = parseDate(r.type_completed_at);
    if (typeCompletedAt) events.push({ ts: typeCompletedAt, title: `Stage marked complete (${r.submission_type})`, user: r.created_by || "—" });
    const completed = parseDate(r.completed_at);
    if (completed) events.push({ ts: completed, title: `Submission #${r.id} completed`, user: r.created_by || "—" });
    const holdTs = parseDate(r.hold_ts);
    if (holdTs) events.push({ ts: holdTs, title: `Submission #${r.id} put ON HOLD`, user: r.hold_user || r.created_by || "—" });
  }

  for (const co of changeOrders) {
    const created = parseDate(co.created_at);
    if (created) events.push({ ts: created, title: `Change Order #${co.co_number} (${co.change_type}) created`, user: co.created_by || "—" });
    const updated = parseDate(co.updated_at);
    if (updated && (!created || updated.getTime() !== created.getTime())) {
      events.push({ ts: updated, title: `Change Order #${co.co_number} updated`, user: co.updated_by || co.created_by || "—" });
    }
  }

  for (const rfi of rfis) {
    const created = parseDate(rfi.created_at);
    if (created) events.push({ ts: created, title: `${rfi.type} "${rfi.title}" created`, user: rfi.created_by || "—" });
    const updated = parseDate(rfi.updated_at);
    if (updated && (!created || updated.getTime() !== created.getTime())) {
      events.push({ ts: updated, title: `${rfi.type} "${rfi.title}" updated`, user: rfi.updated_by || rfi.created_by || "—" });
    }
  }

  for (const ev of deletedEvents) {
    const ts = parseDate(ev.ts);
    if (ts) events.push({ ts, title: ev.title, user: ev.user || "—" });
  }

  events.sort((a, b) => b.ts - a.ts);
  return events.slice(0, limit).map((e) => ({ ...e, dateStr: fmtDateLong(e.ts) }));
}
