const express = require("express");
const path = require("path");
const createSafeRouter = require("../utils/safeRouter");
const { Project, Client, Record } = require("../models");
const { requireRole, requireAuth } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { writeLog } = require("../services/logging");
const statusEngine = require("../services/statusEngine");
const { canUpdateRecords } = require("../services/settingsService");
const {
  PROJECT_IMAGES_DIR,
  sanitizeFilename,
  saveUploadedFile,
  resolveProjectImagePath,
  deleteProjectImage,
} = require("../utils/fileStorage");
const env = require("../config/env");

const router = createSafeRouter();

/**
 * GET /api/projects — list projects + clients master lists. Read-only, and
 * needed by every role's record forms (the project/client pickers), not
 * just admin/management/team_lead — `projects`/`clients` stay flat name
 * arrays for existing consumers (record forms, reports, drilldowns);
 * `projectDetails` adds each project's client for the Manage Projects &
 * Clients page's grouped view.
 */
router.get("/", requireAuth, async (req, res) => {
  const [projects, clients] = await Promise.all([
    Project.find({}).sort({ name: 1 }).lean(),
    Client.find({}).sort({ name: 1 }).lean(),
  ]);
  res.json({
    projects: projects.map((p) => p.name),
    clients: clients.map((c) => c.name),
    projectDetails: projects.map((p) => ({ name: p.name, client: p.client || "" })),
  });
});

/**
 * GET /api/projects/:name — one project's own record (currently just its
 * completion signoffs — see action=mark_completed/mark_ofa_completed/
 * mark_fab_completed below), for the Project Lifecycle widget's "Mark
 * Project/OFA/Fabrication Completed" buttons. A project only gets its own
 * `Project` doc once someone explicitly adds it via action=add — plenty of
 * projects exist purely as the `project` field on their records (bulk-
 * imported data, or a name typed straight into a submission) and never go
 * through that flow. Those are still real projects, just with nothing
 * signed off yet, so a missing doc 404s only when there are no records
 * under that name either — otherwise it reports the all-false default.
 */
router.get("/:name", requireAuth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const p = await Project.findOne({ name }).lean();
  if (!p) {
    if (!(await Record.exists({ project: name }))) {
      return res.status(404).json({ ok: false, error: "Project not found." });
    }
    return res.json({
      name,
      client: "",
      completed: false,
      completed_at: "",
      ofa_completed: false,
      ofa_completed_at: "",
      fab_completed: false,
      fab_completed_at: "",
      image_filename: "",
      quoted_hours: 0,
    });
  }
  res.json({
    name: p.name,
    client: p.client || "",
    completed: !!p.completed,
    completed_at: p.completedAt ? new Date(p.completedAt).toISOString() : "",
    ofa_completed: !!p.ofaCompleted,
    ofa_completed_at: p.ofaCompletedAt ? new Date(p.ofaCompletedAt).toISOString() : "",
    fab_completed: !!p.fabCompleted,
    fab_completed_at: p.fabCompletedAt ? new Date(p.fabCompletedAt).toISOString() : "",
    image_filename: p.imageFilename || "",
    quoted_hours: p.quotedHours || 0,
  });
});

/**
 * POST /api/projects/:name/quoted-hours — sets the project's quoted hours.
 * Gated by the same "who can update records" permission as editing records
 * (settingsService.canUpdateRecords), not the admin/management/team_lead
 * role check the rest of this router's mutations use — this is meant to be
 * editable by the same people who can edit submissions/change orders.
 */
router.post("/:name/quoted-hours", requireAuth, async (req, res) => {
  if (!(await canUpdateRecords(req.session.userId, req.session.role))) {
    return res.status(403).json({ ok: false, error: "You don't have permission to update this project." });
  }
  const name = decodeURIComponent(req.params.name);
  const hours = Number(req.body.quoted_hours);
  if (!Number.isFinite(hours) || hours < 0) {
    return res.status(400).json({ ok: false, error: "Quoted hours must be a non-negative number." });
  }
  await Project.updateOne({ name }, { $set: { quotedHours: hours } }, { upsert: true });
  writeLog("PROJECT-QUOTED-HOURS", `'${name}' set to ${hours}h`, req.session.username);
  res.json({ ok: true, quoted_hours: hours });
});

/**
 * POST /api/projects/:name/image — multipart `image` file, upserts the
 * project's cover image. Gated by the same "who can update records"
 * permission as editing records (settingsService.canUpdateRecords) — the
 * client's canEdit prop on SubmissionOverview rides the same flag.
 */
router.post("/:name/image", requireAuth, upload.single("image"), async (req, res) => {
  if (!(await canUpdateRecords(req.session.userId, req.session.role))) {
    return res.status(403).json({ ok: false, error: "You don't have permission to update this project." });
  }
  const name = decodeURIComponent(req.params.name);
  if (!req.file) return res.status(400).json({ ok: false, error: "No image provided." });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!env.allowedImageExts.includes(ext)) {
    return res.status(400).json({ ok: false, error: "Invalid image type." });
  }
  try {
    const filename = saveUploadedFile(PROJECT_IMAGES_DIR, sanitizeFilename(name), req.file.originalname, req.file.buffer);
    const prev = await Project.findOne({ name }).lean();
    await Project.updateOne({ name }, { $set: { imageFilename: filename } }, { upsert: true });
    if (prev?.imageFilename && prev.imageFilename !== filename) deleteProjectImage(prev.imageFilename);
    writeLog("PROJECT-IMAGE-UPLOAD", `'${name}'`, req.session.username);
    res.json({ ok: true, image_filename: filename });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** POST /api/projects/:name/image/delete — removes the project's cover image. */
router.post("/:name/image/delete", requireAuth, async (req, res) => {
  if (!(await canUpdateRecords(req.session.userId, req.session.role))) {
    return res.status(403).json({ ok: false, error: "You don't have permission to update this project." });
  }
  const name = decodeURIComponent(req.params.name);
  const prev = await Project.findOneAndUpdate({ name }, { $set: { imageFilename: "" } });
  if (prev?.imageFilename) deleteProjectImage(prev.imageFilename);
  writeLog("PROJECT-IMAGE-DELETE", `'${name}'`, req.session.username);
  res.json({ ok: true });
});

/** GET /api/projects/image/:filename — authenticated file serve. */
router.get("/image/:filename", requireAuth, (req, res) => {
  const resolved = resolveProjectImagePath(req.params.filename);
  if (!resolved) return res.status(404).json({ ok: false, error: "Not found" });
  res.sendFile(path.resolve(resolved));
});

/**
 * POST /api/projects — single action-based endpoint, mirrors the Flask
 * `/projects` route's `action` field: add | edit | delete | add_client |
 * edit_client | delete_client. delete/delete_client require delete_password.
 * A project always belongs to a client (by name); renaming/deleting a
 * client cascades to the projects that reference it (rename follows,
 * delete unassigns — existing projects and records are never deleted).
 */
router.post("/", requireRole("admin", "management", "team_lead"), async (req, res) => {
  const b = req.body;
  const action = String(b.action || "").trim();
  const user = req.session.username;

  try {
    switch (action) {
      case "add": {
        const name = String(b.project_name || "").trim();
        const clientName = String(b.client_name || "").trim();
        if (!name) return res.status(400).json({ ok: false, error: "Project name required." });
        if (!clientName) return res.status(400).json({ ok: false, error: "Client required." });
        if (!(await Client.exists({ name: clientName }))) {
          return res.status(400).json({ ok: false, error: "Client not found." });
        }
        await Project.updateOne({ name }, { $set: { name, client: clientName } }, { upsert: true });
        writeLog("ADD-PROJECT", `'${name}' (client: '${clientName}')`, user);
        return res.json({ ok: true, message: `Project '${name}' added under '${clientName}'.` });
      }
      case "edit": {
        const oldName = String(b.old_name || "").trim();
        const newName = String(b.new_name || "").trim();
        const clientName = b.client_name != null ? String(b.client_name).trim() : undefined;
        if (!oldName || !newName) return res.status(400).json({ ok: false, error: "Both names required." });
        if (clientName !== undefined) {
          if (!clientName) return res.status(400).json({ ok: false, error: "Client required." });
          if (!(await Client.exists({ name: clientName }))) {
            return res.status(400).json({ ok: false, error: "Client not found." });
          }
        }
        const update = { name: newName };
        if (clientName !== undefined) update.client = clientName;
        await Project.updateOne({ name: oldName }, { $set: update });
        writeLog("EDIT-PROJECT", `'${oldName}'→'${newName}'`, user);
        return res.json({ ok: true, message: "Project updated." });
      }
      case "delete": {
        const name = String(b.project_name || "").trim();
        if (String(b.delete_password || "").trim() !== env.deletePassword) {
          return res.status(403).json({ ok: false, error: "Wrong password." });
        }
        await Project.deleteOne({ name });
        writeLog("DEL-PROJECT", `'${name}'`, user);
        return res.json({ ok: true, message: `Project '${name}' deleted. Existing records are not affected.` });
      }
      case "add_client": {
        const name = String(b.client_name || "").trim();
        if (!name) return res.status(400).json({ ok: false, error: "Client name required." });
        await Client.updateOne({ name }, { name }, { upsert: true });
        writeLog("ADD-CLIENT", `'${name}'`, user);
        return res.json({ ok: true, message: `Client '${name}' added.` });
      }
      case "edit_client": {
        const oldName = String(b.old_name || "").trim();
        const newName = String(b.new_name || "").trim();
        if (!oldName || !newName) return res.status(400).json({ ok: false, error: "Both names required." });
        await Client.updateOne({ name: oldName }, { name: newName });
        await Project.updateMany({ client: oldName }, { $set: { client: newName } });
        writeLog("EDIT-CLIENT", `'${oldName}'→'${newName}'`, user);
        return res.json({ ok: true, message: "Client renamed." });
      }
      case "delete_client": {
        const name = String(b.client_name || "").trim();
        if (String(b.delete_password || "").trim() !== env.deletePassword) {
          return res.status(403).json({ ok: false, error: "Wrong password." });
        }
        await Client.deleteOne({ name });
        // Projects under this client aren't deleted — they just fall back to
        // unassigned, same "deleting doesn't touch what already points at it"
        // rule the "existing records are not affected" note documents below.
        await Project.updateMany({ client: name }, { $set: { client: "" } });
        writeLog("DEL-CLIENT", `'${name}'`, user);
        return res.json({ ok: true, message: `Client '${name}' deleted. Its projects are now unassigned; existing records are not affected.` });
      }
      case "mark_completed": {
        const name = String(b.project_name || "").trim();
        if (!name) return res.status(400).json({ ok: false, error: "Project name required." });
        // Re-check on the server (not just the client's disabled button) —
        // every record under this project must itself be completed. This
        // also doubles as the "does this project actually exist" check —
        // most projects never go through action=add and so have no `Project`
        // doc of their own (see GET /:name above), so gating on Project.exists
        // would 404 real, submission-backed projects.
        const rows = await Record.find({ project: name }).lean();
        if (!rows.length) {
          return res.status(400).json({ ok: false, error: "This project has no submissions yet." });
        }
        const allCompleted = rows.every((r) => {
          const { tag } = statusEngine.computeStatus(r.dueDate, r.status);
          return tag === "completed" || tag === "completed_overdue";
        });
        if (!allCompleted) {
          return res.status(400).json({ ok: false, error: "Every submission in this project must be completed first." });
        }
        const completedAt = new Date();
        await Project.updateOne({ name }, { $set: { completed: true, completedAt } }, { upsert: true });
        writeLog("PROJECT-COMPLETED", `'${name}'`, user);
        return res.json({ ok: true, message: `Project '${name}' marked completed.`, completed_at: completedAt.toISOString() });
      }
      // mark_ofa_completed / mark_fab_completed are fully manual — unlike
      // mark_completed above, there's no "every record already completed"
      // gate; the button that calls these is always enabled. Each is
      // cleared again the moment a fresh submission of the matching type
      // is added to the project (see POST /api/records). Gated on having any
      // submissions at all (see mark_completed's comment above) rather than
      // Project.exists, for the same reason.
      case "mark_ofa_completed": {
        const name = String(b.project_name || "").trim();
        if (!name) return res.status(400).json({ ok: false, error: "Project name required." });
        if (!(await Record.exists({ project: name }))) {
          return res.status(404).json({ ok: false, error: "Project not found." });
        }
        const completedAt = new Date();
        await Project.updateOne({ name }, { $set: { ofaCompleted: true, ofaCompletedAt: completedAt } }, { upsert: true });
        writeLog("OFA-COMPLETED", `'${name}'`, user);
        return res.json({ ok: true, message: `OFA marked completed for '${name}'.`, completed_at: completedAt.toISOString() });
      }
      case "mark_fab_completed": {
        const name = String(b.project_name || "").trim();
        if (!name) return res.status(400).json({ ok: false, error: "Project name required." });
        if (!(await Record.exists({ project: name }))) {
          return res.status(404).json({ ok: false, error: "Project not found." });
        }
        const completedAt = new Date();
        await Project.updateOne({ name }, { $set: { fabCompleted: true, fabCompletedAt: completedAt } }, { upsert: true });
        writeLog("FAB-COMPLETED", `'${name}'`, user);
        return res.json({ ok: true, message: `Fabrication marked completed for '${name}'.`, completed_at: completedAt.toISOString() });
      }
      default:
        return res.status(400).json({ ok: false, error: "Unknown action." });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
