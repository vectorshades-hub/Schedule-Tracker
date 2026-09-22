const createSafeRouter = require("../utils/safeRouter");
const { Rfi } = require("../models");
const { requireAuth, requireRole } = require("../middleware/auth");
const { writeLog } = require("../services/logging");
const statusEngine = require("../services/statusEngine");
const { canDeleteRfis } = require("../services/settingsService");

const RFI_TYPES = ["RFI", "Clarification", "BFA Clarification", "Field Verification", "GC to Verify", "Other"];

const router = createSafeRouter();

/** Pending (no response yet) / Overdue (past expected response, still no response) / Returned. */
function computeRfiStatus(rfi) {
  if (rfi.actualReturnDate) return "Returned";
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

function toRow(rfi) {
  return {
    id: String(rfi._id),
    project: rfi.project,
    type: rfi.type || "RFI",
    title: rfi.title,
    description: rfi.description || "",
    date: rfi.date ? statusEngine.fmtDateOnlyISO(rfi.date) : "",
    expected_response_date: rfi.expectedResponseDate ? statusEngine.fmtDateOnlyISO(rfi.expectedResponseDate) : "",
    actual_return_date: rfi.actualReturnDate ? statusEngine.fmtDateOnlyISO(rfi.actualReturnDate) : "",
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

    if (!project || !title || !dateRaw || !expectedRaw) {
      return res.status(400).json({ ok: false, error: "Please fill all required fields." });
    }

    const actualRaw = String(b.actual_return_date || "").trim();
    const rfi = await Rfi.create({
      project,
      type,
      title,
      description: String(b.description || "").trim(),
      date: statusEngine.parseDate(dateRaw),
      expectedResponseDate: statusEngine.parseDate(expectedRaw),
      actualReturnDate: actualRaw ? statusEngine.parseDate(actualRaw) : null,
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

    if (!project || !title || !dateRaw || !expectedRaw) {
      return res.status(400).json({ ok: false, error: "Please fill all required fields." });
    }

    const actualRaw = String(b.actual_return_date || "").trim();
    const rfi = await Rfi.findByIdAndUpdate(
      req.params.id,
      {
        project,
        type,
        title,
        description: String(b.description || "").trim(),
        date: statusEngine.parseDate(dateRaw),
        expectedResponseDate: statusEngine.parseDate(expectedRaw),
        actualReturnDate: actualRaw ? statusEngine.parseDate(actualRaw) : null,
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
 * POST /api/rfis/:id/response — "Response Received" toggle (admin/management
 * only). Reversible, unlike Change Order's Approve/Reject: turning it on
 * sets actualReturnDate (today, unless one's already recorded — toggling
 * off/on again doesn't lose the original date); turning it off clears it,
 * putting the RFI back to Pending/Overdue.
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

module.exports = router;
