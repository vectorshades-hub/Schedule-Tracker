const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const mongoose = require("mongoose");
const createSafeRouter = require("../utils/safeRouter");
const { Issue, nextSequence } = require("../models");
const { requireRole } = require("../middleware/auth");
const { writeLog } = require("../services/logging");
const statusEngine = require("../services/statusEngine");
const {
  ISSUE_ATTACHMENTS_DIR,
  saveUploadedFile,
  resolveIssueAttachmentPath,
  deleteIssueAttachmentFile,
} = require("../utils/fileStorage");

/**
 * Client Issues — production/QA log every issue email a client sends, attach
 * a screenshot of it (or the saved email itself), and later classify it as
 * our error or not, attaching our response email the same way.
 */

// Everyone on the delivery side can log and update issues; finance has no stake here.
const ISSUE_ROLES = ["admin", "management", "team_lead", "qaqc", "user"];
const STATUSES = ["Under Review", "Our Error", "Not Our Error"];

// Screenshots, a PDF print of the email, or the saved email file itself.
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const ALLOWED_EXTS = [...IMAGE_EXTS, ".pdf", ".eml", ".msg"];
const MAX_FILES_PER_KIND = 10;

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: MAX_FILES_PER_KIND * 2 },
}).fields([
  { name: "issue_files", maxCount: MAX_FILES_PER_KIND },
  { name: "response_files", maxCount: MAX_FILES_PER_KIND },
]);

/** multer errors (too many/too large files) as a clean 400 instead of the generic 500 handler. */
function handleUpload(req, res, next) {
  attachmentUpload(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === "LIMIT_FILE_SIZE" ? "Each file must be 25MB or smaller." : err.message;
    res.status(400).json({ ok: false, error: msg });
  });
}

const router = createSafeRouter();

function fileKind(name) {
  const ext = path.extname(name || "").toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  return "email";
}

function toAttachmentRow(a) {
  return {
    id: String(a._id),
    kind: a.kind,
    original_name: a.originalName || a.filename,
    file_type: fileKind(a.originalName || a.filename),
    size: a.size || 0,
    uploaded_by: a.uploadedBy || "",
    uploaded_at: a.uploadedAt ? new Date(a.uploadedAt).toISOString() : "",
  };
}

function toRow(issue) {
  return {
    id: String(issue._id),
    issue_number: issue.issueNumber || null,
    project: issue.project || "",
    client: issue.client || "",
    title: issue.title,
    description: issue.description || "",
    reported_by: issue.reportedBy || "",
    received_date: issue.receivedDate ? statusEngine.fmtDateOnlyISO(issue.receivedDate) : "",
    status: issue.status || "Under Review",
    response_notes: issue.responseNotes || "",
    response_date: issue.responseDate ? statusEngine.fmtDateOnlyISO(issue.responseDate) : "",
    attachments: (issue.attachments || []).map(toAttachmentRow),
    created_by: issue.createdBy || "",
    created_at: issue.createdAt ? new Date(issue.createdAt).toISOString() : "",
    updated_by: issue.updatedBy || "",
    updated_at: issue.updatedAt ? new Date(issue.updatedAt).toISOString() : "",
  };
}

/** Rejects the whole request up front if any uploaded file has a disallowed extension. */
function validateFiles(req) {
  for (const f of [...(req.files?.issue_files || []), ...(req.files?.response_files || [])]) {
    if (!ALLOWED_EXTS.includes(path.extname(f.originalname).toLowerCase())) {
      return `"${f.originalname}" isn't allowed — use an image, PDF, .eml or .msg file.`;
    }
  }
  return null;
}

/** Writes the request's uploaded files to disk and returns attachment subdocs (not yet saved). */
function storeFiles(req, issueId) {
  const user = req.session.username;
  const out = [];
  for (const [field, kind] of [["issue_files", "issue"], ["response_files", "response"]]) {
    for (const f of req.files?.[field] || []) {
      const prefix = `${issueId}_${crypto.randomBytes(3).toString("hex")}`;
      const filename = saveUploadedFile(ISSUE_ATTACHMENTS_DIR, prefix, f.originalname, f.buffer);
      out.push({ kind, filename, originalName: f.originalname, size: f.size, uploadedBy: user, uploadedAt: new Date() });
    }
  }
  return out;
}

/** Shared create/update field parsing from the multipart body. */
function parseFields(b) {
  const status = STATUSES.includes(b.status) ? b.status : "Under Review";
  const receivedRaw = String(b.received_date || "").trim();
  const responseRaw = String(b.response_date || "").trim();
  return {
    project: String(b.project || "").trim(),
    client: String(b.client || "").trim(),
    title: String(b.title || "").trim(),
    description: String(b.description || "").trim(),
    reportedBy: String(b.reported_by || "").trim(),
    receivedDate: receivedRaw ? statusEngine.parseDate(receivedRaw) : null,
    status,
    responseNotes: String(b.response_notes || "").trim(),
    // A classified issue always gets a response date — today, unless one was entered.
    responseDate: responseRaw ? statusEngine.parseDate(responseRaw) : status !== "Under Review" ? statusEngine.todayUTC() : null,
  };
}

/** GET /api/issues — every logged issue, newest first. Filtering/search happen client-side. */
router.get("/", requireRole(...ISSUE_ROLES), async (req, res) => {
  const rows = await Issue.find({}).sort({ createdAt: -1 }).lean();
  res.json({ issues: rows.map(toRow) });
});

/** POST /api/issues — multipart: issue fields + optional `issue_files[]` / `response_files[]`. */
router.post("/", requireRole(...ISSUE_ROLES), handleUpload, async (req, res) => {
  const user = req.session.username;
  const fields = parseFields(req.body);
  if (!fields.title || !fields.receivedDate) {
    return res.status(400).json({ ok: false, error: "Subject and received date are required." });
  }
  const fileError = validateFiles(req);
  if (fileError) return res.status(400).json({ ok: false, error: fileError });

  const issue = new Issue({ ...fields, createdBy: user, createdAt: new Date() });
  issue.issueNumber = await nextSequence("issue_number");
  const attachments = storeFiles(req, issue._id);
  issue.attachments = attachments;
  try {
    await issue.save();
  } catch (e) {
    for (const a of attachments) deleteIssueAttachmentFile(a.filename);
    throw e;
  }

  writeLog("ADD-ISSUE", `#${issue.issueNumber} project='${fields.project}' title='${fields.title}'`, user, fields.project || undefined);
  res.json({ ok: true, message: `Issue #${issue.issueNumber} logged.`, issue: toRow(issue) });
});

/** PUT /api/issues/:id — multipart: edit fields / status, and append any newly uploaded files. */
router.put("/:id", requireRole(...ISSUE_ROLES), handleUpload, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "Issue not found." });
  const user = req.session.username;
  const fields = parseFields(req.body);
  if (!fields.title || !fields.receivedDate) {
    return res.status(400).json({ ok: false, error: "Subject and received date are required." });
  }
  const fileError = validateFiles(req);
  if (fileError) return res.status(400).json({ ok: false, error: fileError });

  const issue = await Issue.findById(req.params.id);
  if (!issue) return res.status(404).json({ ok: false, error: "Issue not found." });
  const prevStatus = issue.status;

  const attachments = storeFiles(req, issue._id);
  Object.assign(issue, fields, { updatedBy: user, updatedAt: new Date() });
  issue.attachments.push(...attachments);
  try {
    await issue.save();
  } catch (e) {
    for (const a of attachments) deleteIssueAttachmentFile(a.filename);
    throw e;
  }

  const statusNote = prevStatus !== issue.status ? ` status '${prevStatus}' -> '${issue.status}'` : "";
  writeLog("EDIT-ISSUE", `#${issue.issueNumber} title='${issue.title}'${statusNote}`, user, issue.project || undefined);
  res.json({ ok: true, message: `Issue #${issue.issueNumber} updated.`, issue: toRow(issue) });
});

/** DELETE /api/issues/:id — admin/management only; removes the issue and all its files. */
router.delete("/:id", requireRole("admin", "management"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "Issue not found." });
  const issue = await Issue.findByIdAndDelete(req.params.id);
  if (!issue) return res.status(404).json({ ok: false, error: "Issue not found." });
  for (const a of issue.attachments || []) deleteIssueAttachmentFile(a.filename);
  writeLog("DELETE-ISSUE", `#${issue.issueNumber} "${issue.title}" deleted`, req.session.username, issue.project || undefined);
  res.json({ ok: true, message: `Issue #${issue.issueNumber} deleted.` });
});

/**
 * GET /api/issues/:id/attachments/:attId/file — authenticated serve. Images and
 * PDFs open inline (for the preview / lightbox); .eml/.msg download under their
 * original name so they open in the user's mail client.
 */
router.get("/:id/attachments/:attId/file", requireRole(...ISSUE_ROLES), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "Not found" });
  const issue = await Issue.findById(req.params.id).select("attachments").lean();
  const att = (issue?.attachments || []).find((a) => String(a._id) === req.params.attId);
  const resolved = att && resolveIssueAttachmentPath(att.filename);
  if (!resolved) return res.status(404).json({ ok: false, error: "Not found" });

  const name = att.originalName || att.filename;
  if (fileKind(name) === "email" || req.query.download === "1") return res.download(path.resolve(resolved), name);
  res.type(path.extname(name)).sendFile(path.resolve(resolved));
});

/** DELETE /api/issues/:id/attachments/:attId — admin/management, or whoever uploaded it. */
router.delete("/:id/attachments/:attId", requireRole(...ISSUE_ROLES), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "Issue not found." });
  const issue = await Issue.findById(req.params.id);
  const att = issue?.attachments.id(req.params.attId);
  if (!att) return res.status(404).json({ ok: false, error: "Attachment not found." });
  const user = req.session.username;
  if (!["admin", "management"].includes(req.session.role) && att.uploadedBy !== user) {
    return res.status(403).json({ ok: false, error: "Only the uploader or admin/management can remove this file." });
  }
  const { filename, originalName } = att;
  att.deleteOne();
  issue.updatedBy = user;
  issue.updatedAt = new Date();
  await issue.save();
  deleteIssueAttachmentFile(filename);
  writeLog("ISSUE-ATTACHMENT-DELETE", `#${issue.issueNumber} file='${originalName}'`, user, issue.project || undefined);
  res.json({ ok: true, issue: toRow(issue) });
});

module.exports = router;
