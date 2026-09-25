const createSafeRouter = require("../utils/safeRouter");
const { Rfi } = require("../models");
const { requireAuth, requireRole } = require("../middleware/auth");
const { writeLog } = require("../services/logging");
const statusEngine = require("../services/statusEngine");
const { canDeleteRfis } = require("../services/settingsService");

const RFI_TYPES = ["RFI", "Clarification", "BFA Clarification", "Field Verification", "GC to Verify", "Other"];

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
 * `[{ text, response_received_date }]`, dropping blank rows. */
function parseQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q) => ({
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
    title: rfi.title,
    questions,
    date: rfi.date ? statusEngine.fmtDateOnlyISO(rfi.date) : "",
    expected_response_date: rfi.expectedResponseDate ? statusEngine.fmtDateOnlyISO(rfi.expectedResponseDate) : "",
    actual_return_date: allReceived ? receivedDates.sort().slice(-1)[0] : "",
    linked_submission_ids: rfi.linkedSubmissionIds || [],
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

/** POST /api/rfis — create an RFI/Clarification request (admin/management only). */
router.post("/", requireRole("admin", "management"), async (req, res) => {
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

/** PUT /api/rfis/:id — edit an existing RFI/Clarification request (admin/management only). */
router.put("/:id", requireRole("admin", "management"), async (req, res) => {
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
 * (admin/management only), kept only for RFIs created before per-question
 * tracking (no `questions`). Reversible: turning it on sets actualReturnDate
 * (today, unless one's already recorded — toggling off/on again doesn't lose
 * the original date); turning it off clears it, putting the RFI back to
 * Pending/Overdue. RFIs with real `questions` use POST /:id/questions/:qid/response
 * instead.
 */
router.post("/:id/response", requireRole("admin", "management"), async (req, res) => {
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
 * Received" toggle (admin/management only). Same reversible behavior as the
 * legacy whole-RFI toggle above, but scoped to one question, so an RFI with
 * several questions can have each answered on its own date.
 */
router.post("/:id/questions/:qid/response", requireRole("admin", "management"), async (req, res) => {
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

module.exports = router;
