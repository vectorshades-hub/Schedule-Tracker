const mongoose = require("mongoose");
const createSafeRouter = require("../utils/safeRouter");
const { Bfa, Record } = require("../models");
const { requireAuth, requireRole } = require("../middleware/auth");
const { writeLog } = require("../services/logging");
const statusEngine = require("../services/statusEngine");

// Same roles that can create/edit RFIs (routes/rfis.js RFI_EDIT_ROLES).
const BFA_EDIT_ROLES = ["admin", "management", "team_lead"];

const router = createSafeRouter();

/** Whole days from the submission's due date to today (0 if not yet due), or null with no due date. */
function daysFromDue(dueDate) {
  const due = statusEngine.parseDate(dueDate);
  return due ? Math.max(0, statusEngine.daysBetween(statusEngine.todayUTC(), due)) : null;
}

/** The manual override when set, else the live count from the TR's due date. */
function daysAwaited(bfa, record) {
  return bfa.daysAwaitedOverride ?? daysFromDue(record?.dueDate);
}

/** legacyId → Record (name + due date) for the given BFA docs' TRs. */
async function loadSubmissions(bfas) {
  const ids = [...new Set(bfas.map((b) => b.submissionId))];
  const rows = ids.length ? await Record.find({ legacyId: { $in: ids } }).select("legacyId submissionName dueDate").lean() : [];
  return new Map(rows.map((r) => [r.legacyId, r]));
}

function toRow(bfa, record) {
  return {
    id: String(bfa._id),
    project: bfa.project,
    tr_number: bfa.trNumber || "",
    status: bfa.status || "No",
    submission_id: bfa.submissionId,
    submission_name: record?.submissionName || "",
    submission_due_date: record?.dueDate ? statusEngine.fmtDateOnlyISO(record.dueDate) : "",
    submitted_date: bfa.submittedDate ? statusEngine.fmtDateOnlyISO(bfa.submittedDate) : "",
    description: bfa.description || "",
    days_awaited: daysAwaited(bfa, record),
    days_awaited_auto: daysFromDue(record?.dueDate),
    days_awaited_override: bfa.daysAwaitedOverride ?? null,
    created_by: bfa.createdBy || "",
    created_at: bfa.createdAt ? new Date(bfa.createdAt).toISOString() : "",
    updated_by: bfa.updatedBy || "",
    updated_at: bfa.updatedAt ? new Date(bfa.updatedAt).toISOString() : "",
  };
}

/** Validates the create/edit body; returns { fields } or { error }. */
async function parseBody(b) {
  const project = String(b.project || "").trim();
  const trNumber = String(b.tr_number || "").trim();
  const submissionId = Number(b.submission_id);
  const submittedRaw = String(b.submitted_date || "").trim();
  if (!project || !trNumber || !b.submission_id || !Number.isFinite(submissionId) || !submittedRaw) {
    return { error: "Please enter a TR#, select a submission and a submitted date." };
  }
  const record = await Record.findOne({ legacyId: submissionId, project }).select("legacyId submissionName dueDate").lean();
  if (!record) return { error: "That submission isn't in this project." };

  const overrideRaw = b.days_awaited_override;
  const hasOverride = overrideRaw !== null && overrideRaw !== undefined && String(overrideRaw).trim() !== "";
  const override = hasOverride ? Math.round(Number(overrideRaw)) : null;
  if (hasOverride && !(Number.isFinite(override) && override >= 0)) {
    return { error: "Days awaited must be a whole number of 0 or more." };
  }

  return {
    record,
    fields: {
      project,
      trNumber,
      submissionId,
      submittedDate: statusEngine.parseDate(submittedRaw),
      status: b.status === "Yes" ? "Yes" : "No",
      description: String(b.description || "").trim(),
      daysAwaitedOverride: override,
    },
  };
}

/** GET /api/bfas?project=X — a project's BFA/IFA tracking entries, oldest submitted first. */
router.get("/", requireAuth, async (req, res) => {
  const project = String(req.query.project || "").trim();
  if (!project) return res.json({ bfas: [] });
  const rows = await Bfa.find({ project }).sort({ submittedDate: 1, createdAt: 1 }).lean();
  const subs = await loadSubmissions(rows);
  res.json({ bfas: rows.map((b) => toRow(b, subs.get(b.submissionId))) });
});

/** POST /api/bfas — add a BFA/IFA tracking entry. */
router.post("/", requireRole(...BFA_EDIT_ROLES), async (req, res) => {
  const { error, fields, record } = await parseBody(req.body);
  if (error) return res.status(400).json({ ok: false, error });
  const bfa = await Bfa.create({ ...fields, createdBy: req.session.username, createdAt: new Date() });
  writeLog("ADD-BFA", `project='${fields.project}' tr='${fields.trNumber}' submission='${record.submissionName}'`, req.session.username, fields.project);
  res.json({ ok: true, message: `BFA TR# ${fields.trNumber} added.`, bfa: toRow(bfa, record) });
});

/** PUT /api/bfas/:id — edit a BFA/IFA tracking entry. */
router.put("/:id", requireRole(...BFA_EDIT_ROLES), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "BFA not found." });
  const { error, fields, record } = await parseBody(req.body);
  if (error) return res.status(400).json({ ok: false, error });
  const bfa = await Bfa.findByIdAndUpdate(
    req.params.id,
    { ...fields, updatedBy: req.session.username, updatedAt: new Date() },
    { new: true }
  );
  if (!bfa) return res.status(404).json({ ok: false, error: "BFA not found." });
  writeLog("EDIT-BFA", `project='${fields.project}' tr='${fields.trNumber}' submission='${record.submissionName}' status='${fields.status}'`, req.session.username, fields.project);
  res.json({ ok: true, message: `BFA TR# ${fields.trNumber} updated.`, bfa: toRow(bfa, record) });
});

/** DELETE /api/bfas/:id */
router.delete("/:id", requireRole(...BFA_EDIT_ROLES), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "BFA not found." });
  const bfa = await Bfa.findByIdAndDelete(req.params.id);
  if (!bfa) return res.status(404).json({ ok: false, error: "BFA not found." });
  writeLog("DELETE-BFA", `BFA TR# ${bfa.trNumber || "—"} (submission #${bfa.submissionId}) deleted`, req.session.username, bfa.project);
  res.json({ ok: true, message: "BFA deleted." });
});

module.exports = router;
module.exports.daysAwaited = daysAwaited;
module.exports.loadSubmissions = loadSubmissions;
