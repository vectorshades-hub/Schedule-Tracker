const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const { Record, Project } = require("../models");
const { nextSequence } = require("../models/Counter");
const statusEngine = require("../services/statusEngine");
const { loadRecords, rowToRecord } = require("../services/recordVisibility");
const {
  getTeamsFromUsers,
  getAllowedTeamsForUser,
  getLinkedTls,
  getDefaultTl,
  getManagementUsersForTeamlead,
  getAllTeamleadsInManagement,
} = require("../services/userHelpers");
const { writeLog, pushNotification, buildAddDetail, buildUpdateDetail, getUnseenCount } = require("../services/logging");
const { archiveRecord } = require("../services/completedLogArchiver");
const { ensureBillableChangeOrder } = require("../services/changeOrderAuto");
const { requireAuth, requireRole } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { HOLD_IMAGES_DIR, saveUploadedFile, deleteHoldImage } = require("../utils/fileStorage");
const { canEditInvoiceReleased, canUpdateRecords, canDeleteRecords } = require("../services/settingsService");

const BILLABLE_ROLES = ["admin", "management", "team_lead"];

// Mirrors OFA_TYPES/FAB_TYPES in client/src/lib/projectLifecycle.js — which
// group a submission_type falls into decides which manual project-level
// signoff (ofaCompleted vs fabCompleted) a fresh submission invalidates.
const OFA_TYPES = new Set(["OFA", "REAPPROVAL", "FOR REVIEW"]);
const FAB_TYPES = new Set(["FAB", "FIELD USE", "REVISION"]);

const router = createSafeRouter();

/** GET /api/records/due-date?sub_date=YYYY-MM-DD — sub_date + 7 days. */
router.get("/due-date", requireAuth, (req, res) => {
  const due = statusEngine.dueFromSub(req.query.sub_date);
  res.json({ due_date: due ? statusEngine.fmtDateOnlyISO(due) : "" });
});

/**
 * GET /api/records/dashboard-config — replicates the team-selection logic
 * from Flask's GET /management route (index.html has no equivalent; admin
 * always sees every team). `teams` (client-selected) is optional — when
 * given, it's validated/restricted the same way the original did on POST.
 */
router.get("/dashboard-config", requireAuth, async (req, res) => {
  const { username, role } = req.session;
  const requested = (req.query.teams || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const submitted = req.query.submitted === "1";

  if (role === "admin") {
    const allTeams = await getTeamsFromUsers();
    return res.json({
      selectableTeams: allTeams,
      selectedTeams: allTeams,
      hasCrossTeam: false,
      showTeamSelector: true,
      defaultTeam: "",
    });
  }

  const allTeams = await getTeamsFromUsers();
  let selectableTeams;
  if (role === "management") {
    const allowed = await getAllowedTeamsForUser(username);
    selectableTeams = allowed.length ? allowed : allTeams;
    if (!selectableTeams.includes(username)) {
      selectableTeams = [...new Set([...selectableTeams, username])].sort();
    }
  } else if (role === "qaqc" || role === "user") {
    selectableTeams = await getLinkedTls(username);
  } else if (role === "team_lead") {
    const mgmtCross = await getManagementUsersForTeamlead(username);
    if (mgmtCross.length) {
      const peerSet = new Set();
      for (const mu of mgmtCross) {
        peerSet.add(mu);
        for (const tl of await getAllTeamleadsInManagement(mu)) peerSet.add(tl);
      }
      selectableTeams = peerSet.size ? [...peerSet].sort() : [username];
    } else {
      selectableTeams = [username];
    }
  } else {
    selectableTeams = allTeams;
  }

  let selectedTeams = requested;
  if (role === "management" && !submitted && !requested.length) {
    selectedTeams = [...selectableTeams];
  }
  const hasCrossTeamMgmt = role === "team_lead" ? (await getManagementUsersForTeamlead(username)).length > 0 : true;
  if (role === "team_lead" && !hasCrossTeamMgmt) {
    selectedTeams = [username];
  } else if (role === "team_lead" && hasCrossTeamMgmt && !submitted) {
    selectedTeams = [...selectableTeams];
  }
  if (role === "qaqc") {
    if (!submitted) {
      const defaultTl = await getDefaultTl(username);
      if (defaultTl && selectableTeams.includes(defaultTl)) selectedTeams = [defaultTl];
      else if (selectableTeams.length) selectedTeams = [selectableTeams[0]];
      else selectedTeams = [];
    } else {
      const allowedSet = new Set(selectableTeams.map((t) => t.toLowerCase()));
      selectedTeams = requested.filter((t) => allowedSet.has(t.toLowerCase()));
    }
  }
  if (role === "user") {
    if (!submitted) selectedTeams = [...selectableTeams];
    else {
      const allowedSet = new Set(selectableTeams.map((t) => t.toLowerCase()));
      selectedTeams = requested.filter((t) => allowedSet.has(t.toLowerCase()));
    }
  }
  if (role === "team_lead" && submitted) {
    const allowedSet = new Set(selectableTeams.map((t) => t.toLowerCase()));
    const filtered = requested.filter((t) => allowedSet.has(t.toLowerCase()));
    selectedTeams = filtered.length ? filtered : [username];
  }
  if (role === "management") {
    const allowedSet = new Set(selectableTeams);
    selectedTeams = selectedTeams.filter((t) => allowedSet.has(t));
  }

  const showTeamSelector =
    role === "management" ||
    (role === "team_lead" && hasCrossTeamMgmt) ||
    (role === "qaqc" && selectableTeams.length > 1);
  const defaultTeam = role === "team_lead" || role === "management" ? username : "";

  res.json({
    selectableTeams,
    selectedTeams,
    hasCrossTeam: hasCrossTeamMgmt,
    showTeamSelector,
    defaultTeam,
  });
});

/**
 * GET /api/records — AJAX list w/ pagination, sort, search, team/date filters.
 * Mirrors Flask's /api/records exactly, but returns JSON rows instead of a
 * rendered HTML partial (the React table renders rows itself).
 */
router.get("/", requireAuth, async (req, res) => {
  const { username, role } = req.session;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const search = String(req.query.search || "").trim().toLowerCase();
  const teamsStr = String(req.query.teams || "");
  const sortCol = String(req.query.sort || "");
  const sortDir = String(req.query.dir || "asc");
  const datesStr = String(req.query.dates || "");
  const dateFrom = String(req.query.date_from || "").trim();
  const dateTo = String(req.query.date_to || "").trim();
  const PAGE_SIZE = 100;

  const selectedTeams = teamsStr
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  // Note: the dashboard always sends `teams` explicitly once mounted (even an
  // intentionally empty selection after "Clear"), so an empty selectedTeams
  // here must mean "show nothing" — it must NOT collapse to "unrestricted".
  let records;
  if (role === "admin") {
    records = await loadRecords(username, "admin");
    const sl = selectedTeams.map((t) => t.toLowerCase());
    records = records.filter((r) => sl.includes(r.team.toLowerCase()) || sl.includes(r.created_by.toLowerCase()));
  } else if (role === "management") {
    records = await loadRecords("", "management", selectedTeams);
  } else {
    records = await loadRecords(username, role, selectedTeams);
  }

  if (datesStr) {
    const today = statusEngine.todayUTC();
    const iso = (d) => statusEngine.fmtDateOnlyISO(d);
    const yest = new Date(today.getTime() - 86400000);
    const tom = new Date(today.getTime() + 86400000);
    const dateMap = { yesterday: iso(yest), today: iso(today), tomorrow: iso(tom) };
    const targets = new Set(datesStr.split(",").filter((d) => dateMap[d]).map((d) => dateMap[d]));
    if (targets.size) records = records.filter((r) => targets.has(r.sub_date_raw || ""));
  }

  // Custom date range on Sub Date — sub_date_raw is yyyy-MM-dd, so plain
  // string comparison sorts the same as a date comparison would.
  if (dateFrom) records = records.filter((r) => (r.sub_date_raw || "") >= dateFrom);
  if (dateTo) records = records.filter((r) => (r.sub_date_raw || "") <= dateTo);

  if (search) {
    records = records.filter((r) =>
      `${r.project} ${r.submission_name} ${r.client} ${r.team} ${r.status} ${r.remarks || ""} ${r.submission_type}`
        .toLowerCase()
        .includes(search)
    );
  }

  const sortKeys = {
    project: (r) => r.project.toLowerCase(),
    submission: (r) => r.submission_name.toLowerCase(),
    client: (r) => r.client.toLowerCase(),
    type: (r) => r.submission_type.toLowerCase(),
    team: (r) => r.team.toLowerCase(),
    sub_date: (r) => r.sub_date_raw || "",
    due_date: (r) => r.due_date_raw || "",
    status: (r) => r.status.toLowerCase(),
  };
  if (sortKeys[sortCol]) {
    const keyFn = sortKeys[sortCol];
    records.sort((a, b) => (keyFn(a) < keyFn(b) ? -1 : keyFn(a) > keyFn(b) ? 1 : 0));
    if (sortDir === "desc") records.reverse();
  } else {
    const rank = (tag) => (tag === "hold" ? 0 : tag.startsWith("completed") ? 2 : 1);
    records.sort((a, b) => {
      const ra = rank(a.tag),
        rb = rank(b.tag);
      if (ra !== rb) return ra - rb;
      return (a.sub_date_raw || "") < (b.sub_date_raw || "") ? -1 : (a.sub_date_raw || "") > (b.sub_date_raw || "") ? 1 : 0;
    });
  }

  const total = records.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const start = (pageClamped - 1) * PAGE_SIZE;
  const pageRecords = records.slice(start, start + PAGE_SIZE).map((r, i) => ({ ...r, row_number: start + i + 1 }));

  res.json({ records: pageRecords, total, page: pageClamped, pages: totalPages, page_size: PAGE_SIZE });
});

/** POST /api/records — add a new record (multipart, may include onhold_file). */
router.post("/", requireAuth, upload.single("onhold_file"), async (req, res) => {
  const user = req.session.username;
  const role = req.session.role;
  try {
    const b = req.body;
    const project = (b.project || "").trim();
    const submissionName = (b.submission_name || "").trim();
    const client = (b.client || "").trim();
    const submissionType = (b.submission_type || "").trim();
    const steelType = (b.steel_type || "").trim();
    const team = (b.team || "").trim();
    const subDateRaw = (b.sub_date || "").trim();
    const remarks = (b.remarks || "").trim();
    const statusOverride = (b.status_override || "").trim();

    if (!project || !submissionName || !client || !submissionType || !team) {
      return res.status(400).json({ ok: false, error: "Please fill all required fields." });
    }

    const subDate = subDateRaw ? statusEngine.parseDate(subDateRaw) : null;
    const dueDateRaw = (b.due_date || "").trim();
    const dueDate = dueDateRaw ? statusEngine.parseDate(dueDateRaw) : statusEngine.dueFromSub(subDate);

    let status, completedAt;
    if (statusOverride === "COMPLETED") {
      status = statusEngine.resolveCompleteStatus(dueDate).status;
      completedAt = statusEngine.completedAtNow();
    } else if (statusOverride === "ON HOLD") {
      status = "ON HOLD";
      completedAt = null;
    } else {
      status = statusEngine.computeStatus(dueDate).status;
      completedAt = null;
    }

    const createdBy = role === "admin" || role === "management" ? team : user;
    const legacyId = await nextSequence("recordId");

    // Billable defaults to "No" and Invoice Released defaults to empty on a
    // new record; only respected here if the request explicitly sends one,
    // subject to the same authoritative role/settings check as the
    // toggle-field route.
    let billable = "No";
    if (BILLABLE_ROLES.includes(role) && ["Yes", "No", ""].includes(b.billable)) {
      billable = b.billable;
    }
    let invoiceReleased = "";
    if (["Yes", "No", ""].includes(b.invoice_released) && (await canEditInvoiceReleased(req.session.userId, role))) {
      invoiceReleased = b.invoice_released;
    }

    const record = await Record.create({
      legacyId,
      project,
      submissionName,
      client,
      submissionType,
      steelType,
      team,
      subDate,
      dueDate,
      remarks,
      status,
      createdAt: new Date(),
      completedAt,
      createdBy,
      qaqc: "",
      percentage: 0,
      billable,
      invoiceReleased,
      // Created already-COMPLETED — keep the lifecycle widget's "type" stage
      // in sync from the start (see the matching guard in PUT /:id above).
      typeCompleted: statusOverride === "COMPLETED",
      typeCompletedAt: statusOverride === "COMPLETED" ? completedAt : null,
    });

    if (statusOverride === "ON HOLD") {
      const ohNote = (b.onhold_note || "").trim();
      let imgFn = "";
      if (req.file) imgFn = saveUploadedFile(HOLD_IMAGES_DIR, legacyId, req.file.originalname, req.file.buffer);
      if (ohNote || imgFn) {
        record.hold = { text: ohNote, imageFilename: imgFn, user, ts: new Date() };
        await record.save();
      }
    }

    // A fresh submission means this project's earlier "Mark Project
    // Completed" signoff (see routes/projects.js action=mark_completed) no
    // longer holds — and, more specifically, whichever of the OFA/
    // Fabrication signoffs (action=mark_ofa_completed / mark_fab_completed)
    // matches this submission's own type-group no longer holds either,
    // since a fresh submission in that group means that stage isn't really
    // done anymore. Overwriting an already-false field is harmless.
    const submissionTypeUpper = submissionType.toUpperCase();
    const projectReset = { completed: false, completedAt: null };
    if (OFA_TYPES.has(submissionTypeUpper)) {
      projectReset.ofaCompleted = false;
      projectReset.ofaCompletedAt = null;
    } else if (FAB_TYPES.has(submissionTypeUpper)) {
      projectReset.fabCompleted = false;
      projectReset.fabCompletedAt = null;
    }
    await Project.updateOne({ name: project }, { $set: projectReset });

    await ensureBillableChangeOrder(record, user);

    writeLog("ADD", `ID=${legacyId} '${project}'/'${submissionName}' status=${status}`, user);
    pushNotification(
      "ADD",
      buildAddDetail(
        legacyId, project, submissionName, client, submissionType, team,
        statusEngine.fmtDateOnlyISO(subDate), statusEngine.fmtDateOnlyISO(dueDate), remarks, status
      ),
      user
    );
    res.json({ ok: true, message: `Record #${legacyId} added successfully.`, id: legacyId });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Error: ${e.message}` });
  }
});

/** PUT /api/records/:id — update (multipart, may include onhold_file). Gated by the
 * Settings page's "who can update records" list (settingsService.canUpdateRecords),
 * not a shared password. */
router.put("/:id", requireAuth, upload.single("onhold_file"), async (req, res) => {
  const user = req.session.username;
  const role = req.session.role;
  try {
    if (!(await canUpdateRecords(req.session.userId, role))) {
      return res.status(403).json({ ok: false, error: "You don't have permission to update records." });
    }
    const recordId = req.params.id;
    const b = req.body;

    const project = (b.project || "").trim();
    const submissionName = (b.submission_name || "").trim();
    const client = (b.client || "").trim();
    const submissionType = (b.submission_type || "").trim();
    const team = (b.team || "").trim();
    const subDateRaw = (b.sub_date || "").trim();
    const dueDateRaw = (b.due_date || "").trim();
    const remarks = (b.remarks || "").trim();
    const statusOverride = (b.status_override || "").trim();

    if (![project, submissionName, client, submissionType, team].every(Boolean)) {
      return res.status(400).json({ ok: false, error: "Please fill all required fields." });
    }

    const subDate = subDateRaw ? statusEngine.parseDate(subDateRaw) : null;
    const dueDate = dueDateRaw ? statusEngine.parseDate(dueDateRaw) : statusEngine.dueFromSub(subDate);

    const existing = await Record.findOne({ legacyId: recordId });
    if (!existing) return res.status(404).json({ ok: false, error: "Record not found." });
    const before = existing.toObject();

    let status, completedAt;
    if (statusOverride === "COMPLETED") {
      status = statusEngine.resolveCompleteStatus(dueDate).status;
      completedAt = existing.completedAt || statusEngine.completedAtNow();
    } else if (statusOverride === "ON HOLD") {
      status = "ON HOLD";
      completedAt = null;
    } else if (statusOverride === "__RELEASE__") {
      status = statusEngine.computeStatus(dueDate).status;
      completedAt = null;
    } else if (statusOverride) {
      status = statusEngine.computeStatus(dueDate, statusOverride).status;
      completedAt = statusOverride.includes("COMPLETED") ? existing.completedAt : null;
    } else {
      status = statusEngine.computeStatus(dueDate).status;
      completedAt = null;
    }

    existing.project = project;
    existing.submissionName = submissionName;
    existing.client = client;
    existing.submissionType = submissionType;
    // Not every caller's edit form includes this field (e.g. the project/client
    // drilldown page's Edit form doesn't) — only touch it when explicitly sent,
    // so submitting from a form that omits it doesn't silently clear it.
    if (b.steel_type !== undefined) existing.steelType = (b.steel_type || "").trim();
    existing.team = team;
    existing.subDate = subDate;
    existing.dueDate = dueDate;
    existing.remarks = remarks;
    existing.status = status;
    existing.completedAt = completedAt;

    // Completing a submission's status here also marks the Project
    // Lifecycle widget's "type" stage done, so the two can't drift out of
    // sync regardless of which flow completed it — this normal Edit form,
    // or the lifecycle widget's own two-step Complete Stage → Mark Completed
    // flow (which already sets typeCompleted first, hence the guard below).
    if (statusOverride === "COMPLETED" && !existing.typeCompleted) {
      existing.typeCompleted = true;
      existing.typeCompletedAt = completedAt;
    }

    // Percentage is admin/management-only — silently ignore it from anyone
    // else's edit submission (the field is hidden from their form, but this
    // is the authoritative check regardless of what the client sends).
    if (["admin", "management"].includes(role) && b.percentage !== undefined && b.percentage !== "") {
      const pct = Number(b.percentage);
      if (Number.isFinite(pct)) {
        existing.percentage = Math.max(0, Math.min(100, Math.round(pct)));
      }
    }

    // Same idea for Billable (admin/management/team_lead) and Invoice Released
    // (admin, or whoever's on the configured editors list) — authoritative
    // check here regardless of what the client's form sends.
    if (BILLABLE_ROLES.includes(role) && ["Yes", "No", ""].includes(b.billable)) {
      existing.billable = b.billable;
    }
    if (["Yes", "No", ""].includes(b.invoice_released) && (await canEditInvoiceReleased(req.session.userId, role))) {
      existing.invoiceReleased = b.invoice_released;
    }

    if (statusOverride === "ON HOLD") {
      const ohNote = (b.onhold_note || "").trim();
      const prevImgFn = existing.hold?.imageFilename || "";
      let imgFn = prevImgFn;
      if (req.file) {
        imgFn = saveUploadedFile(HOLD_IMAGES_DIR, recordId, req.file.originalname, req.file.buffer);
        if (prevImgFn && prevImgFn !== imgFn) deleteHoldImage(prevImgFn); // replacing — drop the old file
      }
      existing.hold = { text: ohNote, imageFilename: imgFn, user, ts: new Date() };
    }

    await existing.save();
    await ensureBillableChangeOrder(existing, user);

    const after = { project, submission_name: submissionName, status, remarks };
    writeLog("UPDATE", `ID=${recordId} '${project}' status=${status}`, user);
    pushNotification("UPDATE", buildUpdateDetail(recordId, before, after), user);

    if (statusOverride === "COMPLETED") {
      await archiveRecord(existing.toObject(), user);
    }

    res.json({ ok: true, message: `Record #${recordId} updated.` });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Error: ${e.message}` });
  }
});

/** DELETE /api/records/:id — gated by the Settings page's "who can delete records"
 * list (settingsService.canDeleteRecords), not a shared password. */
router.delete("/:id", requireAuth, async (req, res) => {
  const user = req.session.username;
  const role = req.session.role;
  try {
    if (!(await canDeleteRecords(req.session.userId, role))) {
      return res.status(403).json({ ok: false, error: "You don't have permission to delete records." });
    }
    const recordId = req.params.id;
    const row = await Record.findOneAndDelete({ legacyId: recordId });
    if (!row) return res.status(404).json({ ok: false, error: "Record not found." });
    if (row.hold?.imageFilename) deleteHoldImage(row.hold.imageFilename);

    writeLog("DELETE", `ID=${recordId} deleted`, user);
    pushNotification(
      "DELETE",
      `record_id=${recordId}|project=${row.project}|submission=${row.submissionName}|detail=Record permanently deleted`,
      user
    );
    res.json({ ok: true, message: `Record #${recordId} deleted.` });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Error: ${e.message}` });
  }
});

// field (client name) -> [Mongoose field, roles allowed to set it]. invoice_released
// isn't role-based — it's checked separately against the configured editors list.
const TOGGLE_FIELDS = {
  back_comment: ["backComment", ["admin", "qaqc"]],
  further_comment: ["furtherComment", ["admin", "qaqc"]],
  billable: ["billable", BILLABLE_ROLES],
};

/** POST /api/records/:id/toggle-field — back_comment/further_comment (admin/qaqc),
 * billable (admin/management/team_lead), or invoice_released (admin, or whoever's
 * on the Settings page's editors list). */
router.post("/:id/toggle-field", requireAuth, async (req, res) => {
  const field = String(req.body.field || "").trim();
  const value = String(req.body.value || "").trim();
  if (!["Yes", "No", ""].includes(value)) {
    return res.status(400).json({ ok: false, error: "Invalid value" });
  }

  let dbField;
  if (field === "invoice_released") {
    if (!(await canEditInvoiceReleased(req.session.userId, req.session.role))) {
      return res.status(403).json({ ok: false, error: "Not allowed." });
    }
    dbField = "invoiceReleased";
  } else {
    const entry = TOGGLE_FIELDS[field];
    if (!entry) return res.status(400).json({ ok: false, error: "Invalid field" });
    const [mapped, allowedRoles] = entry;
    if (!allowedRoles.includes(req.session.role)) {
      return res.status(403).json({ ok: false, error: "Not allowed." });
    }
    dbField = mapped;
  }

  try {
    // findOneAndUpdate returns the PRE-update doc by default — `r.billable`
    // below is still the old value, so ensureBillableChangeOrder is passed
    // `value` (the new one) instead of trusting `r[dbField]`.
    const r = await Record.findOneAndUpdate({ legacyId: req.params.id }, { [dbField]: value });
    if (!r) return res.status(404).json({ ok: false, error: "Record not found" });
    if (field === "billable") {
      await ensureBillableChangeOrder({ ...r.toObject(), billable: value }, req.session.username);
    }
    writeLog("FIELD-UPDATE", `ID=${req.params.id} ${field}='${value}'`, req.session.username);
    res.json({ ok: true, value });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** POST /api/records/:id/qaqc — QAQC Yes/No/'' toggle (admin/qaqc only). */
router.post("/:id/qaqc", requireRole("admin", "qaqc"), async (req, res) => {
  const value = String(req.body.qaqc_value || "").trim();
  if (!["Yes", "No", ""].includes(value)) {
    return res.status(400).json({ ok: false, error: "Invalid value" });
  }
  try {
    const r = await Record.findOneAndUpdate({ legacyId: req.params.id }, { qaqc: value });
    if (!r) return res.status(404).json({ ok: false, error: "Record not found" });
    writeLog("QAQC-UPDATE", `ID=${req.params.id} QAQC='${value}'`, req.session.username);
    res.json({ ok: true, qaqc: value });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/records/:id/type-complete — marks the Project Lifecycle widget's
 * current "type" stage done, with a timestamp. Deliberately separate from
 * the record's own status/completedAt: this must NOT complete the record
 * (or, when it's the project's only record, the whole project) — that still
 * only happens through the normal COMPLETED status flow. One-directional
 * (no un-completing) and idempotent-safe — a second call 400s instead of
 * silently overwriting the original completion timestamp.
 */
router.post("/:id/type-complete", requireRole("admin", "management"), async (req, res) => {
  try {
    const r = await Record.findOne({ legacyId: req.params.id });
    if (!r) return res.status(404).json({ ok: false, error: "Record not found" });
    if (r.typeCompleted) {
      return res.status(400).json({ ok: false, error: "Already marked complete." });
    }
    r.typeCompleted = true;
    r.typeCompletedAt = new Date();
    await r.save();
    writeLog("FIELD-UPDATE", `ID=${req.params.id} typeCompleted=true`, req.session.username);
    res.json({ ok: true, type_completed: true, type_completed_at: r.typeCompletedAt.toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** GET /api/records/by-project?project=X — role-scoped drill-down listing. Every
 * submission for this project shows up here regardless of the completed-records
 * grace period (see loadRecords' includeAllCompleted) — that cutoff exists to
 * declutter the main dashboard, not to hide history on a project's own page. */
router.get("/by-project", requireAuth, async (req, res) => {
  const { username, role } = req.session;
  const project = String(req.query.project || "");
  const records = (await loadRecords(username, role, null, { includeAllCompleted: true })).filter(
    (r) => r.project === project
  );
  res.json({ records, unseen_notif: role === "admin" || role === "management" ? await getUnseenCount(username) : 0 });
});

/** GET /api/records/by-client?client=X — role-scoped drill-down listing. */
router.get("/by-client", requireAuth, async (req, res) => {
  const { username, role } = req.session;
  const client = String(req.query.client || "");
  const records = (await loadRecords(username, role)).filter((r) => r.client === client);
  res.json({ records, unseen_notif: role === "admin" || role === "management" ? await getUnseenCount(username) : 0 });
});

/**
 * GET /api/records/:id — single record, for the submission detail page.
 * Registered last (not near the other GET routes above) so this catch-all
 * `:id` param can never shadow a fixed path like /by-project or /due-date.
 * Same role-based visibility as the list endpoint — just one record instead
 * of the whole set.
 */
router.get("/:id", requireAuth, async (req, res) => {
  const { username, role } = req.session;
  const records = await loadRecords(username, role);
  const record = records.find((r) => r.id === String(req.params.id));
  if (!record) return res.status(404).json({ ok: false, error: "Record not found." });
  res.json({ record });
});

module.exports = router;
