const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const ExcelJS = require("exceljs");
const { CompletedLog, Record } = require("../models");
const { requireAuth, requireRole } = require("../middleware/auth");
const { writeLog } = require("../services/logging");
const { canEditCompletedLog, canEditInvoiceReleased } = require("../services/settingsService");

const router = createSafeRouter();

const AUTO_ACTORS = new Set(["auto-delete", "auto-archive"]);

/** Team-lead scoping — a single shared predicate used by BOTH the view and the export
 * (the original Flask app had these diverge: the export route only checked exact
 * created_by/team equality, missing the prefix-match the view route used — a confirmed
 * bug, unified here so both routes show/export the same rows for a given team lead). */
function isMineForTeamlead(entry, usernameLower) {
  const cb = (entry.createdBy || "").toLowerCase();
  const t = (entry.team || "").toLowerCase();
  return cb === usernameLower || t === usernameLower || t.startsWith(usernameLower + "(") || t.startsWith(usernameLower + " ");
}

async function fetchScoped(req) {
  const { username, role } = req.session;
  let rows = await CompletedLog.find({}).sort({ archivedAt: -1 }).lean();
  if (role === "team_lead") {
    const ul = username.toLowerCase();
    rows = rows.filter((e) => isMineForTeamlead(e, ul));
  }
  return rows;
}

/** 'YYYY-MM-DDTHH:MM:SS.sssZ' (or already-blank) -> 'YYYY-MM-DD HH:MM'. */
function fmtMinute(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function toClient(e) {
  return {
    id: String(e._id),
    archived_at: fmtMinute(e.archivedAt),
    record_id: e.recordId,
    project: e.project,
    submission_name: e.submissionName,
    client: e.client,
    submission_type: e.submissionType,
    steel_type: e.steelType || "",
    team: e.team,
    sub_date: e.subDate,
    due_date: e.dueDate,
    remarks: e.remarks,
    created_at: fmtMinute(e.createdAt),
    completed_at: fmtMinute(e.completedAt),
    created_by: e.createdBy,
    archived_by: e.archivedBy,
    qaqc: e.qaqc,
    percentage: e.percentage ?? 0,
    billable: e.billable || "",
    invoice_released: e.invoiceReleased || "",
  };
}

/** GET /api/completed-log — admin/management/team_lead. */
router.get("/", requireRole("admin", "management", "team_lead"), async (req, res) => {
  const rows = await fetchScoped(req);
  const teams = [...new Set(rows.map((r) => r.team).filter(Boolean))].sort();
  const archivers = [...new Set(rows.map((r) => r.archivedBy).filter((a) => a && !AUTO_ACTORS.has(a)))].sort();
  const types = [...new Set(rows.map((r) => r.submissionType).filter(Boolean))].sort();
  const autoCount = rows.filter((r) => AUTO_ACTORS.has(r.archivedBy)).length;

  res.json({
    entries: rows.map(toClient),
    filters: { teams, archivers, types },
    total: rows.length,
    auto_count: autoCount,
    marked_by_user_count: rows.length - autoCount,
  });
});

/** GET /api/completed-log/export */
router.get("/export", requireRole("admin", "management", "team_lead"), async (req, res) => {
  const rows = await fetchScoped(req);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Completed Log");
  ws.addRow(["Archived At", "ID", "Project", "Submission", "Client", "Type", "Team", "Sub Date", "Due Date", "Completed At", "QC Done", "Percentage", "Billable", "Invoice Released", "Created By", "Archived By"]);
  for (const r of rows) {
    ws.addRow([
      new Date(r.archivedAt).toISOString().slice(0, 19).replace("T", " "),
      r.recordId,
      r.project,
      r.submissionName,
      r.client,
      r.submissionType,
      r.team,
      r.subDate,
      r.dueDate,
      r.completedAt,
      r.qaqc,
      r.percentage ?? 0,
      r.billable || "",
      r.invoiceReleased || "",
      r.createdBy,
      r.archivedBy,
    ]);
  }

  const ts = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const filename = `completed_log_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

/**
 * POST /api/completed-log/:id/toggle-field — updates Billable or Invoice
 * Released on the archived log entry itself, and also on the live Record
 * (matched by its `recordId`/legacyId) when that record still exists, so the
 * two never drift apart — this is the one place either field can still be
 * corrected once a submission has aged off the main dashboard. Unlike
 * records.js's identically-named toggle (which gates billable by role),
 * billable here is gated by the Settings page's "who can edit completed log"
 * list (settingsService.canEditCompletedLog) — that list already grants
 * editing rights over every other field on this log, so it's the sole gate
 * here rather than an addition to a role check; admins still always pass,
 * since canEditCompletedLog itself allows role === "admin".
 * invoice_released needs the Settings page's editors list (settingsService.canEditInvoiceReleased).
 */
router.post("/:id/toggle-field", requireAuth, async (req, res) => {
  const field = String(req.body.field || "").trim();
  const value = String(req.body.value || "").trim();
  if (!["billable", "invoice_released"].includes(field)) {
    return res.status(400).json({ ok: false, error: "Invalid field" });
  }
  if (!["Yes", "No", ""].includes(value)) {
    return res.status(400).json({ ok: false, error: "Invalid value" });
  }
  if (field === "billable") {
    if (!(await canEditCompletedLog(req.session.userId, req.session.role))) {
      return res.status(403).json({ ok: false, error: "Not allowed." });
    }
  } else if (!(await canEditInvoiceReleased(req.session.userId, req.session.role))) {
    return res.status(403).json({ ok: false, error: "Not allowed." });
  }
  const dbField = field === "billable" ? "billable" : "invoiceReleased";

  try {
    const entry = await CompletedLog.findByIdAndUpdate(req.params.id, { [dbField]: value }, { new: true });
    if (!entry) return res.status(404).json({ ok: false, error: "Entry not found" });
    if (entry.recordId != null) {
      await Record.updateOne({ legacyId: entry.recordId }, { [dbField]: value });
    }
    writeLog("COMPLETED-LOG-FIELD-UPDATE", `id=${req.params.id} ${field}='${value}'`, req.session.username);
    res.json({ ok: true, value });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * PUT /api/completed-log/:id — edit an archived entry's details. Gated by the
 * Settings page's "who can edit completed log" list (settingsService.canEditCompletedLog),
 * same pattern as records.js's PUT /:id. Also mirrors the edited fields onto the
 * live Record (matched by recordId) when it still exists, so the dashboard and
 * the archive can't drift apart for a submission that hasn't aged off yet.
 */
router.put("/:id", requireAuth, async (req, res) => {
  if (!(await canEditCompletedLog(req.session.userId, req.session.role))) {
    return res.status(403).json({ ok: false, error: "You don't have permission to edit the completed log." });
  }
  const b = req.body;
  const project = (b.project || "").trim();
  const submissionName = (b.submission_name || "").trim();
  const client = (b.client || "").trim();
  const submissionType = (b.submission_type || "").trim();
  const team = (b.team || "").trim();

  if (!project || !submissionName || !client || !submissionType || !team) {
    return res.status(400).json({ ok: false, error: "Please fill all required fields." });
  }

  const update = {
    project,
    submissionName,
    client,
    submissionType,
    steelType: (b.steel_type || "").trim(),
    team,
    subDate: (b.sub_date || "").trim(),
    dueDate: (b.due_date || "").trim(),
    remarks: (b.remarks || "").trim(),
  };
  if (b.percentage !== undefined && b.percentage !== "") {
    const pct = Number(b.percentage);
    if (Number.isFinite(pct)) update.percentage = Math.max(0, Math.min(100, Math.round(pct)));
  }

  try {
    const entry = await CompletedLog.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!entry) return res.status(404).json({ ok: false, error: "Entry not found" });
    if (entry.recordId != null) {
      await Record.updateOne(
        { legacyId: entry.recordId },
        {
          project,
          submissionName,
          client,
          submissionType,
          steelType: update.steelType,
          team,
          remarks: update.remarks,
          ...(update.percentage !== undefined ? { percentage: update.percentage } : {}),
        }
      );
    }
    writeLog("COMPLETED-LOG-UPDATE", `id=${req.params.id} '${project}'/'${submissionName}'`, req.session.username);
    res.json({ ok: true, message: "Completed Log entry updated.", entry: toClient(entry.toObject()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** GET /api/completed-log/backfill-qaqc — admin only, one-off repair: copy qaqc from records where missing. */
router.get("/backfill-qaqc", requireRole("admin"), async (req, res) => {
  try {
    const missing = await CompletedLog.find({ $or: [{ qaqc: null }, { qaqc: "" }] }).lean();
    let updated = 0;
    for (const entry of missing) {
      const record = await Record.findOne({ legacyId: entry.recordId }).select("qaqc").lean();
      if (record && record.qaqc) {
        await CompletedLog.updateOne({ _id: entry._id }, { qaqc: record.qaqc });
        updated++;
      }
    }
    writeLog("BACKFILL-QAQC", `Updated ${updated} completed_log rows`, req.session.username);
    res.type("text").send(`Backfill done. Updated ${updated} rows.`);
  } catch (e) {
    res.type("text").status(500).send(`Error: ${e.message}`);
  }
});

/** GET /api/completed-log/backfill-billing — admin only, one-off repair: copy
 * billable/invoiceReleased from records where missing (added after these rows existed). */
router.get("/backfill-billing", requireRole("admin"), async (req, res) => {
  try {
    const missing = await CompletedLog.find({
      $or: [{ billable: { $in: [null, ""] } }, { invoiceReleased: { $in: [null, ""] } }],
    }).lean();
    let updated = 0;
    for (const entry of missing) {
      const record = await Record.findOne({ legacyId: entry.recordId }).select("billable invoiceReleased").lean();
      if (!record) continue;
      const update = {};
      if (!entry.billable && record.billable) update.billable = record.billable;
      if (!entry.invoiceReleased && record.invoiceReleased) update.invoiceReleased = record.invoiceReleased;
      if (Object.keys(update).length) {
        await CompletedLog.updateOne({ _id: entry._id }, update);
        updated++;
      }
    }
    writeLog("BACKFILL-BILLING", `Updated ${updated} completed_log rows`, req.session.username);
    res.type("text").send(`Backfill done. Updated ${updated} rows.`);
  } catch (e) {
    res.type("text").status(500).send(`Error: ${e.message}`);
  }
});

module.exports = router;
