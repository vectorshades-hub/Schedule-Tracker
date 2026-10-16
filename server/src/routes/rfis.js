const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const mongoose = require("mongoose");
const { PDFDocument } = require("pdf-lib");
const createSafeRouter = require("../utils/safeRouter");
const { Rfi, Record } = require("../models");
const { requireAuth, requireRole } = require("../middleware/auth");
const { writeLog } = require("../services/logging");
const statusEngine = require("../services/statusEngine");
const { canDeleteRfis } = require("../services/settingsService");
const { RFI_MARKUPS_DIR, saveUploadedFile, resolveRfiMarkupPath, deleteRfiMarkupFile, sanitizeFilename } = require("../utils/fileStorage");

// Its own multer instance rather than middleware/upload's 25MB one — drawing
// sets uploaded for markup routinely run larger than that.
const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
// Images pasted/dropped onto a markup page (screenshots, photos).
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/** The image's extension, sniffed from its magic bytes (PNG/JPEG/GIF/WebP), or null. */
function sniffImageExt(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return ".png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return ".gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return ".webp";
  return null;
}

const RFI_TYPES = ["RFI", "Clarification", "BFA Clarification", "Field Verification", "GC to Verify", "Other"];

// Roles that can create/edit RFIs, toggle responses and edit markups
// (client: SubmissionOverview's canEditRfi). Deleting is separate — see canDeleteRfis.
const RFI_EDIT_ROLES = ["admin", "management", "team_lead"];

const router = createSafeRouter();

/** Pending (no response yet) / Overdue (past expected response, still no response) / Returned
 * (every question answered — or, for pre-multi-question RFIs with no `questions`, the legacy
 * whole-RFI `actualReturnDate`). */
function computeRfiStatus(rfi) {
  const questions = rfi.questions || [];
  const allQuestionsReceived = questions.length > 0 && questions.every((q) => q.responseReceivedDate);
  if (allQuestionsReceived || (questions.length === 0 && rfi.actualReturnDate)) return "Returned";
  if (rfi.expectedResponseDate) {
    const today = statusEngine.todayUTC();
    const expected = statusEngine.parseDate(rfi.expectedResponseDate);
    if (expected && expected.getTime() < today.getTime()) return "Overdue";
  }
  return "Pending";
}

function parseLinkedSubmissionIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => Number(v)).filter((n) => Number.isFinite(n)))];
}

/** Builds the `questions` array for create/update from the client's
 * `[{ id?, text, response_received_date }]`, dropping blank rows. An existing
 * question's `id` is kept as its `_id`, so editing an RFI doesn't orphan the
 * PDF marks (markupDocs[].marks[].questionId) that point at it. */
function parseQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q) => ({
      ...(q?.id && mongoose.isValidObjectId(q.id) ? { _id: q.id } : {}),
      text: String(q?.text || "").trim(),
      answer: String(q?.answer || "").trim(),
      responseReceivedDate: q?.response_received_date ? statusEngine.parseDate(String(q.response_received_date).trim()) : null,
    }))
    .filter((q) => q.text);
}

function toQuestionRow(q) {
  return {
    id: String(q._id),
    text: q.text,
    answer: q.answer || "",
    response_received_date: q.responseReceivedDate ? statusEngine.fmtDateOnlyISO(q.responseReceivedDate) : "",
  };
}

function toRow(rfi) {
  // Older RFIs (created before per-question tracking) have no `questions` —
  // surface their single legacy description/actualReturnDate as one synthetic
  // question so the UI only ever has to deal with the `questions` list.
  const questions =
    rfi.questions && rfi.questions.length
      ? rfi.questions.map(toQuestionRow)
      : rfi.description
      ? [{ id: "legacy", text: rfi.description, answer: "", response_received_date: rfi.actualReturnDate ? statusEngine.fmtDateOnlyISO(rfi.actualReturnDate) : "" }]
      : [];
  const receivedDates = questions.map((q) => q.response_received_date).filter(Boolean);
  const allReceived = questions.length > 0 && receivedDates.length === questions.length;

  return {
    id: String(rfi._id),
    project: rfi.project,
    type: rfi.type || "RFI",
    rfi_number: rfi.rfiNumber || "",
    title: rfi.title,
    questions,
    date: rfi.date ? statusEngine.fmtDateOnlyISO(rfi.date) : "",
    expected_response_date: rfi.expectedResponseDate ? statusEngine.fmtDateOnlyISO(rfi.expectedResponseDate) : "",
    actual_return_date: allReceived ? receivedDates.sort().slice(-1)[0] : "",
    linked_submission_ids: rfi.linkedSubmissionIds || [],
    markup_doc_count: (rfi.markupDocs || []).length,
    status: computeRfiStatus(rfi),
    created_by: rfi.createdBy || "",
    created_at: rfi.createdAt ? new Date(rfi.createdAt).toISOString() : "",
    updated_by: rfi.updatedBy || "",
    updated_at: rfi.updatedAt ? new Date(rfi.updatedAt).toISOString() : "",
  };
}

/** GET /api/rfis?project=X — list a project's RFI/Clarification requests, newest first. */
router.get("/", requireAuth, async (req, res) => {
  const project = String(req.query.project || "").trim();
  if (!project) return res.json({ rfis: [] });
  const rows = await Rfi.find({ project }).sort({ createdAt: -1 }).lean();
  res.json({ rfis: rows.map(toRow) });
});

// An RFI still waiting on a response this many days after it was sent shows
// up in the reminders list (and fires a browser notification — see NotificationBell).
const REMINDER_AFTER_DAYS = 5;

/**
 * A team lead's "own" RFIs: ones linked to a submission that's theirs (team
 * matches them, same rule as recordVisibility.teamMatch, or they created it)
 * — or, for RFIs with no linked submissions, ones on a project where they
 * have any submission. Returns a predicate over Rfi docs.
 */
async function teamLeadRfiFilter(username) {
  const esc = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const own = await Record.find({
    $or: [{ team: new RegExp(`^${esc}($|[( ])`, "i") }, { createdBy: new RegExp(`^${esc}$`, "i") }],
  })
    .select("legacyId project")
    .lean();
  const ownIds = new Set(own.map((r) => r.legacyId));
  const ownProjects = new Set(own.map((r) => r.project));
  return (rfi) =>
    rfi.linkedSubmissionIds && rfi.linkedSubmissionIds.length
      ? rfi.linkedSubmissionIds.some((id) => ownIds.has(id))
      : ownProjects.has(rfi.project);
}

/**
 * GET /api/rfis/reminders — every RFI that's still not Returned (Pending or
 * Overdue) more than REMINDER_AFTER_DAYS days after its date (falls back to
 * createdAt when no date was entered). Oldest first. Admin/management see
 * all projects; team leads only their own (see teamLeadRfiFilter).
 */
router.get("/reminders", requireRole(...RFI_EDIT_ROLES), async (req, res) => {
  const today = statusEngine.todayUTC();
  const cutoff = new Date(today.getTime() - REMINDER_AFTER_DAYS * 86400000);
  const candidates = await Rfi.find({
    $or: [{ date: { $lt: cutoff } }, { date: null, createdAt: { $lt: cutoff } }],
  }).lean();
  const isVisible =
    req.session.role === "team_lead" ? await teamLeadRfiFilter(req.session.username || "") : () => true;

  const reminders = candidates
    .filter(isVisible)
    .filter((rfi) => computeRfiStatus(rfi) !== "Returned")
    .map((rfi) => {
      const row = toRow(rfi);
      const sent = statusEngine.parseDate(rfi.date || rfi.createdAt);
      return {
        ...row,
        sent_date: statusEngine.fmtDateOnlyISO(sent),
        days_pending: statusEngine.daysBetween(today, sent),
        open_questions: row.questions.filter((q) => !q.response_received_date).length,
      };
    })
    .sort((a, b) => b.days_pending - a.days_pending);

  res.json({ threshold_days: REMINDER_AFTER_DAYS, reminders });
});

/** POST /api/rfis — create an RFI/Clarification request (admin/management/team lead). */
router.post("/", requireRole(...RFI_EDIT_ROLES), async (req, res) => {
  const user = req.session.username;
  const b = req.body;
  try {
    const project = String(b.project || "").trim();
    const title = String(b.title || "").trim();
    const dateRaw = String(b.date || "").trim();
    const expectedRaw = String(b.expected_response_date || "").trim();
    const type = RFI_TYPES.includes(b.type) ? b.type : "RFI";
    const questions = parseQuestions(b.questions);

    if (!project || !title || !dateRaw || !expectedRaw || !questions.length) {
      return res.status(400).json({ ok: false, error: "Please fill all required fields and add at least one question." });
    }

    const rfi = await Rfi.create({
      project,
      type,
      rfiNumber: String(b.rfi_number ?? "").trim(),
      title,
      questions,
      date: statusEngine.parseDate(dateRaw),
      expectedResponseDate: statusEngine.parseDate(expectedRaw),
      linkedSubmissionIds: parseLinkedSubmissionIds(b.linked_submission_ids),
      createdBy: user,
      createdAt: new Date(),
    });

    writeLog("ADD-RFI", `project='${project}' title='${title}'`, user);
    res.json({ ok: true, message: `${type} "${title}" created.`, rfi: toRow(rfi) });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Error: ${e.message}` });
  }
});

/** PUT /api/rfis/:id — edit an existing RFI/Clarification request (admin/management/team lead). */
router.put("/:id", requireRole(...RFI_EDIT_ROLES), async (req, res) => {
  const user = req.session.username;
  const b = req.body;
  try {
    const project = String(b.project || "").trim();
    const title = String(b.title || "").trim();
    const dateRaw = String(b.date || "").trim();
    const expectedRaw = String(b.expected_response_date || "").trim();
    const type = RFI_TYPES.includes(b.type) ? b.type : "RFI";
    const questions = parseQuestions(b.questions);

    if (!project || !title || !dateRaw || !expectedRaw || !questions.length) {
      return res.status(400).json({ ok: false, error: "Please fill all required fields and add at least one question." });
    }

    const rfi = await Rfi.findByIdAndUpdate(
      req.params.id,
      {
        project,
        type,
        rfiNumber: String(b.rfi_number ?? "").trim(),
        title,
        questions,
        date: statusEngine.parseDate(dateRaw),
        expectedResponseDate: statusEngine.parseDate(expectedRaw),
        linkedSubmissionIds: parseLinkedSubmissionIds(b.linked_submission_ids),
        updatedBy: user,
        updatedAt: new Date(),
      },
      { new: true }
    );
    if (!rfi) return res.status(404).json({ ok: false, error: "RFI not found." });

    writeLog("EDIT-RFI", `project='${project}' title='${title}'`, user);
    res.json({ ok: true, message: `${type} "${title}" updated.`, rfi: toRow(rfi) });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Error: ${e.message}` });
  }
});

/** DELETE /api/rfis/:id — gated by the Settings page's "who can delete RFIs" list
 * (settingsService.canDeleteRfis), not a shared password. */
router.delete("/:id", requireAuth, async (req, res) => {
  if (!(await canDeleteRfis(req.session.userId, req.session.role))) {
    return res.status(403).json({ ok: false, error: "You don't have permission to delete RFIs." });
  }
  try {
    const rfi = await Rfi.findByIdAndDelete(req.params.id);
    if (!rfi) return res.status(404).json({ ok: false, error: "RFI not found." });
    for (const doc of rfi.markupDocs || []) {
      deleteRfiMarkupFile(doc.filename);
      for (const img of doc.images || []) deleteRfiMarkupFile(img.filename);
    }
    // `project` passed through so the submission detail page's Activity
    // panel can recover this after the document itself is gone.
    writeLog("DELETE-RFI", `${rfi.type} "${rfi.title}" deleted`, req.session.username, rfi.project);
    res.json({ ok: true, message: `"${rfi.title}" deleted.` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/rfis/:id/response — legacy whole-RFI "Response Received" toggle
 * (admin/management/team lead), kept only for RFIs created before per-question
 * tracking (no `questions`). Reversible: turning it on sets actualReturnDate
 * (today, unless one's already recorded — toggling off/on again doesn't lose
 * the original date); turning it off clears it, putting the RFI back to
 * Pending/Overdue. RFIs with real `questions` use POST /:id/questions/:qid/response
 * instead.
 */
router.post("/:id/response", requireRole(...RFI_EDIT_ROLES), async (req, res) => {
  const received = !!req.body.received;
  try {
    const rfi = await Rfi.findById(req.params.id);
    if (!rfi) return res.status(404).json({ ok: false, error: "RFI not found." });
    rfi.actualReturnDate = received ? rfi.actualReturnDate || new Date() : null;
    rfi.updatedBy = req.session.username;
    rfi.updatedAt = new Date();
    await rfi.save();
    writeLog("RFI-RESPONSE", `title='${rfi.title}' received='${received}'`, req.session.username);
    res.json({ ok: true, rfi: toRow(rfi) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/rfis/:id/questions/:qid/response — per-question "Response
 * Received" toggle (admin/management/team lead). Same reversible behavior as the
 * legacy whole-RFI toggle above, but scoped to one question, so an RFI with
 * several questions can have each answered on its own date.
 */
router.post("/:id/questions/:qid/response", requireRole(...RFI_EDIT_ROLES), async (req, res) => {
  const received = !!req.body.received;
  try {
    const rfi = await Rfi.findById(req.params.id);
    if (!rfi) return res.status(404).json({ ok: false, error: "RFI not found." });
    const question = rfi.questions.id(req.params.qid);
    if (!question) return res.status(404).json({ ok: false, error: "Question not found." });
    question.responseReceivedDate = received ? question.responseReceivedDate || new Date() : null;
    rfi.updatedBy = req.session.username;
    rfi.updatedAt = new Date();
    await rfi.save();
    writeLog("RFI-RESPONSE", `title='${rfi.title}' question='${question.text}' received='${received}'`, req.session.username);
    res.json({ ok: true, rfi: toRow(rfi) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// PDF markup — PDFs uploaded in the RFI "Mark Up" workspace, each with cloud
// marks tying regions of its pages to the RFI's questions.
// ---------------------------------------------------------------------------

function toMarkupDocRow(doc) {
  return {
    id: String(doc._id),
    original_name: doc.originalName || doc.filename,
    uploaded_by: doc.uploadedBy || "",
    uploaded_at: doc.uploadedAt ? new Date(doc.uploadedAt).toISOString() : "",
    marks: (doc.marks || []).map((m) => ({
      id: m.id,
      question_id: m.questionId,
      page: m.page,
      x: m.x,
      y: m.y,
      w: m.w,
      h: m.h,
      label_x: m.labelX,
      label_y: m.labelY,
      line_end_x: m.lineEndX ?? null,
      line_end_y: m.lineEndY ?? null,
      line_bend_x: m.lineBendX ?? null,
      line_bend_y: m.lineBendY ?? null,
      style: m.style || null,
    })),
    images: (doc.images || []).map((im) => ({
      id: im.id,
      filename: im.filename,
      page: im.page,
      x: im.x,
      y: im.y,
      w: im.w,
      h: im.h,
      locked: !!im.locked,
    })),
  };
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

// Whitelist for a mark's style (client: RfiMarkStylePanel's DEFAULT_MARK_STYLE).
const MARK_STYLE_COLORS = ["borderColor", "fillColor", "textColor", "labelBg", "lineColor"];
const MARK_STYLE_NUMBERS = { borderWidth: [0.5, 10], cloudSize: [3, 25], fillOpacity: [0, 1], fontSize: [6, 40], lineWidth: [0.5, 8] };
const MARK_STYLE_ENUMS = {
  borderStyle: ["cloud", "rect", "dashed"],
  lineStyle: ["solid", "dashed", "dotted", "none"],
  lineEnd: ["dot", "arrow", "none"],
  labelSide: ["center", "auto", "left", "right", "top", "bottom"],
  boxAnchor: ["edge-center", "nearest", "top", "right", "bottom", "left", "center"],
};

/** Keeps only known style keys with valid values; invalid/unknown ones are dropped (client falls back to defaults). */
function parseMarkStyle(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const style = {};
  for (const k of MARK_STYLE_COLORS) if (/^#[0-9a-f]{6}$/i.test(raw[k] || "")) style[k] = raw[k].toLowerCase();
  for (const [k, [lo, hi]] of Object.entries(MARK_STYLE_NUMBERS)) {
    const n = Number(raw[k]);
    if (raw[k] !== undefined && raw[k] !== null && Number.isFinite(n)) style[k] = Math.min(hi, Math.max(lo, n));
  }
  for (const [k, allowed] of Object.entries(MARK_STYLE_ENUMS)) if (allowed.includes(raw[k])) style[k] = raw[k];
  return Object.keys(style).length ? style : undefined;
}

/** `{ [prefix]X, [prefix]Y }` as 0–1 fractions when both are given, else nothing (the point is unset). */
function optionalPoint(prefix, x, y) {
  const has = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
  return has(x) && has(y) ? { [`${prefix}X`]: clamp01(x), [`${prefix}Y`]: clamp01(y) } : {};
}

/** Validates the client's marks list — every coordinate is a 0–1 page fraction. */
function parseMarks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && m.id && m.question_id && Number.isInteger(Number(m.page)) && Number(m.page) >= 1)
    .slice(0, 2000)
    .map((m) => ({
      id: String(m.id).slice(0, 64),
      questionId: String(m.question_id).slice(0, 64),
      page: Number(m.page),
      x: clamp01(m.x),
      y: clamp01(m.y),
      w: clamp01(m.w),
      h: clamp01(m.h),
      labelX: clamp01(m.label_x),
      labelY: clamp01(m.label_y),
      ...optionalPoint("lineEnd", m.line_end_x, m.line_end_y),
      ...optionalPoint("lineBend", m.line_bend_x, m.line_bend_y),
      style: parseMarkStyle(m.style),
    }));
}

/**
 * Validates the client's placed-images list. Only files uploaded for this
 * RFI (named `${rfiId}_img…` by POST …/images) are accepted, so a client
 * can't point a placement at another RFI's file.
 */
function parseImages(raw, rfiId) {
  if (!Array.isArray(raw)) return [];
  const prefix = `${rfiId}_img`;
  return raw
    .filter(
      (im) =>
        im && im.id && typeof im.filename === "string" && sanitizeFilename(im.filename) === im.filename &&
        im.filename.startsWith(prefix) && Number.isInteger(Number(im.page)) && Number(im.page) >= 1
    )
    .slice(0, 500)
    .map((im) => ({
      id: String(im.id).slice(0, 64),
      filename: im.filename,
      page: Number(im.page),
      x: clamp01(im.x),
      y: clamp01(im.y),
      w: Math.max(0.005, clamp01(im.w)),
      h: Math.max(0.005, clamp01(im.h)),
      locked: !!im.locked,
    }));
}

/** GET /api/rfis/:id/markups — the RFI's uploaded PDFs and their marks. */
router.get("/:id/markups", requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "RFI not found." });
  const rfi = await Rfi.findById(req.params.id).select("markupDocs").lean();
  if (!rfi) return res.status(404).json({ ok: false, error: "RFI not found." });
  res.json({ docs: (rfi.markupDocs || []).map(toMarkupDocRow) });
});

/** POST /api/rfis/:id/markups — multipart `pdf`: upload a PDF to mark up (admin/management/team lead). */
router.post("/:id/markups", requireRole(...RFI_EDIT_ROLES), pdfUpload.single("pdf"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: "No file uploaded." });
  const isPdf =
    path.extname(file.originalname).toLowerCase() === ".pdf" && file.buffer.subarray(0, 5).toString("latin1") === "%PDF-";
  if (!isPdf) return res.status(400).json({ ok: false, error: "Only PDF files can be marked up." });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "RFI not found." });

  const rfi = await Rfi.findById(req.params.id);
  if (!rfi) return res.status(404).json({ ok: false, error: "RFI not found." });

  const prefix = `${rfi._id}_${crypto.randomBytes(3).toString("hex")}`;
  const filename = saveUploadedFile(RFI_MARKUPS_DIR, prefix, file.originalname, file.buffer);
  rfi.markupDocs.push({ filename, originalName: file.originalname, uploadedBy: req.session.username, uploadedAt: new Date() });
  try {
    await rfi.save();
  } catch (e) {
    deleteRfiMarkupFile(filename);
    throw e;
  }
  writeLog("RFI-MARKUP-UPLOAD", `title='${rfi.title}' file='${file.originalname}'`, req.session.username);
  res.json({ ok: true, doc: toMarkupDocRow(rfi.markupDocs[rfi.markupDocs.length - 1]) });
});

/** POST /api/rfis/:id/markups/:docId/append — multipart `pdf`: append that PDF's pages to the end of
 * an uploaded markup PDF (admin/management/team lead). Existing pages keep their numbers, so marks and
 * placed images stay where they are. The merged file is saved under a new name and the old one removed. */
router.post("/:id/markups/:docId/append", requireRole(...RFI_EDIT_ROLES), pdfUpload.single("pdf"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: "No file uploaded." });
  if (file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return res.status(400).json({ ok: false, error: "Only PDF files can be added." });
  }
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "RFI not found." });
  const rfi = await Rfi.findById(req.params.id);
  const doc = rfi?.markupDocs.id(req.params.docId);
  const resolved = doc && resolveRfiMarkupPath(doc.filename);
  if (!resolved) return res.status(404).json({ ok: false, error: "Markup not found." });

  let merged;
  let added;
  try {
    const base = await PDFDocument.load(fs.readFileSync(resolved), { ignoreEncryption: true });
    const extra = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
    const pages = await base.copyPages(extra, extra.getPageIndices());
    pages.forEach((p) => base.addPage(p));
    added = pages.length;
    merged = Buffer.from(await base.save());
  } catch (e) {
    return res.status(400).json({ ok: false, error: `Couldn't merge the PDFs: ${e.message}` });
  }

  const oldFilename = doc.filename;
  const prefix = `${rfi._id}_${crypto.randomBytes(3).toString("hex")}`;
  const filename = saveUploadedFile(RFI_MARKUPS_DIR, prefix, doc.originalName || "markup.pdf", merged);
  doc.filename = filename;
  try {
    await rfi.save();
  } catch (e) {
    deleteRfiMarkupFile(filename);
    throw e;
  }
  deleteRfiMarkupFile(oldFilename);
  writeLog("RFI-MARKUP-APPEND", `title='${rfi.title}' file='${doc.originalName}' added='${file.originalname}' pages=${added}`, req.session.username);
  res.json({ ok: true, added_pages: added, doc: toMarkupDocRow(doc) });
});

/** GET /api/rfis/:id/markups/:docId/file — authenticated serve of the uploaded PDF. */
router.get("/:id/markups/:docId/file", requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "Not found" });
  const rfi = await Rfi.findById(req.params.id).select("markupDocs").lean();
  const doc = (rfi?.markupDocs || []).find((d) => String(d._id) === req.params.docId);
  const resolved = doc && resolveRfiMarkupPath(doc.filename);
  if (!resolved) return res.status(404).json({ ok: false, error: "Not found" });
  res.type("application/pdf").sendFile(path.resolve(resolved));
});

/** POST /api/rfis/:id/markups/:docId/images — multipart `image`: store an image to place on the PDF
 * (admin/management/team lead). Returns its filename; the placement itself is saved with the marks (PUT …/marks). */
router.post("/:id/markups/:docId/images", requireRole(...RFI_EDIT_ROLES), imageUpload.single("image"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: "No image uploaded." });
  const ext = sniffImageExt(file.buffer);
  if (!ext) return res.status(400).json({ ok: false, error: "Only PNG, JPEG, GIF or WebP images can be placed." });
  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.docId)) {
    return res.status(404).json({ ok: false, error: "Markup not found." });
  }
  const rfi = await Rfi.findOne({ _id: req.params.id, "markupDocs._id": req.params.docId }).select("_id").lean();
  if (!rfi) return res.status(404).json({ ok: false, error: "Markup not found." });

  const prefix = `${rfi._id}_img${crypto.randomBytes(3).toString("hex")}`;
  const filename = saveUploadedFile(RFI_MARKUPS_DIR, prefix, `image${ext}`, file.buffer);
  res.json({ ok: true, filename });
});

/** GET /api/rfis/:id/markups/:docId/images/:filename — authenticated serve of an image placed on that PDF. */
router.get("/:id/markups/:docId/images/:filename", requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "Not found" });
  const { filename } = req.params;
  // Only files belonging to this RFI — also covers a just-uploaded image whose placement hasn't saved yet.
  if (sanitizeFilename(filename) !== filename || !filename.startsWith(`${req.params.id}_img`)) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  const resolved = resolveRfiMarkupPath(filename);
  if (!resolved) return res.status(404).json({ ok: false, error: "Not found" });
  res.set("Cache-Control", "private, max-age=86400").sendFile(path.resolve(resolved));
});

/** PUT /api/rfis/:id/markups/:docId/marks — replace one PDF's marks, and its placed images when
 * `images` is sent (admin/management/team lead). Image files no longer placed are deleted. */
router.put("/:id/markups/:docId/marks", requireRole(...RFI_EDIT_ROLES), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.docId)) {
    return res.status(404).json({ ok: false, error: "Markup not found." });
  }
  const set = { "markupDocs.$.marks": parseMarks(req.body.marks) };
  const images = Array.isArray(req.body.images) ? parseImages(req.body.images, req.params.id) : null;
  if (images) set["markupDocs.$.images"] = images;
  const before = await Rfi.findOneAndUpdate({ _id: req.params.id, "markupDocs._id": req.params.docId }, { $set: set });
  if (!before) return res.status(404).json({ ok: false, error: "Markup not found." });
  if (images) {
    const kept = new Set(images.map((im) => im.filename));
    for (const im of before.markupDocs.id(req.params.docId)?.images || []) {
      if (!kept.has(im.filename)) deleteRfiMarkupFile(im.filename);
    }
  }
  res.json({ ok: true });
});

/** DELETE /api/rfis/:id/markups/:docId — remove an uploaded PDF and all its marks (admin/management/team lead). */
router.delete("/:id/markups/:docId", requireRole(...RFI_EDIT_ROLES), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ ok: false, error: "RFI not found." });
  const rfi = await Rfi.findById(req.params.id);
  const doc = rfi?.markupDocs.id(req.params.docId);
  if (!doc) return res.status(404).json({ ok: false, error: "Markup not found." });
  const { filename, originalName } = doc;
  const imageFiles = (doc.images || []).map((im) => im.filename);
  doc.deleteOne();
  await rfi.save();
  deleteRfiMarkupFile(filename);
  for (const f of imageFiles) deleteRfiMarkupFile(f);
  writeLog("RFI-MARKUP-DELETE", `title='${rfi.title}' file='${originalName}'`, req.session.username);
  res.json({ ok: true });
});

module.exports = router;
