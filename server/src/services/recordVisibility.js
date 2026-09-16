/**
 * Ported verbatim from app.py's `_row_to_record()` + `load_records()`.
 * Fetches everything and filters in JS (exactly like the original did in
 * Python) rather than translating the role rules into Mongo query
 * operators — this keeps the fiddly string-matching logic (`_team_match`)
 * byte-for-byte identical and easy to audit against the source.
 */
const env = require("../config/env");
const { Record } = require("../models");
const statusEngine = require("./statusEngine");
const {
  getLinkedTls,
  getManagementUsersForTeamlead,
  getAllTeamleadsInManagement,
} = require("./userHelpers");

function teamMatch(team, username) {
  return team === username || team.startsWith(username + "(") || team.startsWith(username + " ");
}

function rowToRecord(row) {
  const { status, tag } = statusEngine.computeStatus(row.dueDate, row.status);
  return {
    id: String(row.legacyId),
    _id: String(row._id),
    project: row.project || "",
    submission_name: row.submissionName || "",
    client: row.client || "",
    submission_type: row.submissionType || "",
    steel_type: row.steelType || "",
    team: row.team || "",
    sub_date: statusEngine.fmtDate(row.subDate),
    sub_date_raw: statusEngine.fmtDateOnlyISO(row.subDate),
    due_date: statusEngine.fmtDate(row.dueDate),
    due_date_raw: statusEngine.fmtDateOnlyISO(row.dueDate),
    remarks: row.remarks || "",
    status,
    tag,
    created_at: statusEngine.fmtDateTime(row.createdAt),
    created_at_raw: row.createdAt || null,
    completed_at: row.completedAt ? new Date(row.completedAt).toISOString() : "",
    created_by: row.createdBy || "",
    qaqc: row.qaqc || "",
    back_comment: row.backComment || "",
    further_comment: row.furtherComment || "",
    billable: row.billable || "",
    invoice_released: row.invoiceReleased || "",
    percentage: row.percentage ?? 0,
    type_completed: !!row.typeCompleted,
    type_completed_at: row.typeCompletedAt ? new Date(row.typeCompletedAt).toISOString() : "",
    hold_text: row.hold ? row.hold.text || "" : "",
    hold_image: row.hold ? row.hold.imageFilename || "" : "",
    hold_ts: row.hold && row.hold.ts ? new Date(row.hold.ts).toISOString() : "",
    hold_user: row.hold ? row.hold.user || "" : "",
  };
}

/**
 * @param {string} username
 * @param {string} role
 * @param {string[]|null} teamsFilter
 * @param {{ includeAllCompleted?: boolean }} [options] - includeAllCompleted skips the
 *   grace-period cutoff below, so every completed record for the caller's role/team
 *   still shows up regardless of how long ago it completed (used by the project detail
 *   page's Submission Details panel — see GET /api/records/by-project).
 */
async function loadRecords(username = "", role = "admin", teamsFilter = null, options = {}) {
  const { includeAllCompleted = false } = options;
  const rawRows = await Record.find({}).sort({ subDate: 1, createdAt: 1 }).lean();

  const graceDays =
    role === "admin" || role === "qaqc" ? env.completedDaysGraceExtended : env.completedDaysGrace;
  const graceCutoff = new Date();
  graceCutoff.setUTCHours(0, 0, 0, 0);
  graceCutoff.setUTCDate(graceCutoff.getUTCDate() - graceDays);

  // Precompute expensive per-role lookups once instead of per-record.
  let linkedLower = null;
  let mgmtCross = null;
  let mgmtPeerTls = null;
  if (role === "user" || role === "qaqc") {
    const linked = await getLinkedTls(username);
    linkedLower = linked.map((l) => l.toLowerCase());
  } else if (role === "team_lead") {
    mgmtCross = await getManagementUsersForTeamlead(username);
    mgmtPeerTls = {};
    for (const mu of mgmtCross) {
      mgmtPeerTls[mu] = (await getAllTeamleadsInManagement(mu)).map((p) => p.toLowerCase());
    }
  }

  const records = [];
  for (const row of rawRows) {
    const rec = rowToRecord(row);
    const tag = rec.tag;

    // Grace period: hide completed records older than the cutoff (never deleted).
    if (!includeAllCompleted && (tag === "completed" || tag === "completed_overdue")) {
      if (row.completedAt) {
        const caDate = new Date(row.completedAt);
        caDate.setUTCHours(0, 0, 0, 0);
        if (caDate.getTime() < graceCutoff.getTime()) continue;
      }
    }

    const teamLower = rec.team.toLowerCase();
    const cbLower = rec.created_by.toLowerCase();

    if (role === "user" || role === "qaqc") {
      if (linkedLower.length) {
        const visible = linkedLower.some((l) => teamMatch(teamLower, l) || cbLower === l);
        if (!visible) continue;
      } else if (role === "user") {
        continue;
      }
    } else if (role === "team_lead") {
      const unameLower = username.toLowerCase();
      const own = teamMatch(teamLower, unameLower) || cbLower === unameLower;
      if (!own) {
        let visible = false;
        for (const mu of mgmtCross) {
          const ml = mu.toLowerCase();
          if (teamMatch(teamLower, ml) || cbLower === ml) {
            visible = true;
            break;
          }
          if (mgmtPeerTls[mu].some((p) => teamMatch(teamLower, p))) {
            visible = true;
            break;
          }
        }
        if (!visible) continue;
      }
    }

    // Array.isArray (not just truthy+length) so an explicitly empty selection
    // — teamsFilter === [] — filters everything out instead of being treated
    // the same as "no filter requested" (teamsFilter === null).
    if (Array.isArray(teamsFilter) && ["management", "team_lead", "qaqc", "user"].includes(role)) {
      const tf = teamsFilter.map((t) => t.toLowerCase());
      if (!tf.includes(teamLower) && !tf.includes(cbLower)) continue;
    }

    records.push(rec);
  }

  return records;
}

module.exports = { loadRecords, rowToRecord, teamMatch };
