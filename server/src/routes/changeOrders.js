const createSafeRouter = require("../utils/safeRouter");
const { ChangeOrder, Record } = require("../models");
const { requireAuth, requireRole } = require("../middleware/auth");
const { writeLog } = require("../services/logging");
const statusEngine = require("../services/statusEngine");
const { canEditInvoiceReleased, canDeleteChangeOrders } = require("../services/settingsService");
const { teamMatch } = require("../services/recordVisibility");
const {
  getLinkedTls,
  getManagementUsersForTeamlead,
  getAllTeamleadsInManagement,
  getChangeOrderApprovers,
  canApproveChangeOrder,
} = require("../services/userHelpers");

const APPROVAL_VALUES = ["Pending", "Approved", "Rejected"];

/** A team-lead CO that hasn't been Approved yet — blocked from finance/invoice release. */
function isAwaitingApproval(co) {
  return !!co.requiresApproval && co.approval !== "Approved";
}

const AWAITING_APPROVAL_ERROR = "This change order needs management approval first.";

const router = createSafeRouter();

/**
 * Same team-visibility shape as recordVisibility.loadRecords(), applied to a
 * Change Order's own `team` field (see the model — set from the source
 * record's team when auto-added, or picked on the create/edit form
 * otherwise). Admins/management see every CO for the project; a blank team
 * (legacy rows never assigned one) stays visible to everyone rather than
 * disappearing.
 */
async function filterChangeOrdersForViewer(rows, username, role) {
  if (role === "admin" || role === "management") return rows;

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

  const unameLower = (username || "").toLowerCase();

  return rows.filter((co) => {
    const teamLower = (co.team || "").toLowerCase();
    if (!teamLower) return true;

    if (role === "user" || role === "qaqc") {
      if (linkedLower.length) return linkedLower.some((l) => teamMatch(teamLower, l));
      return role !== "user"; // qaqc w/ no linked TLs = auditor, sees all; user = sees nothing
    }
    if (role === "team_lead") {
      if (teamMatch(teamLower, unameLower)) return true;
      for (const mu of mgmtCross) {
        const ml = mu.toLowerCase();
        if (teamMatch(teamLower, ml)) return true;
        if (mgmtPeerTls[mu].some((p) => teamMatch(teamLower, p))) return true;
      }
      return false;
    }
    return true;
  });
}

function parseLinkedSubmissionIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => Number(v)).filter((n) => Number.isFinite(n)))];
}

/**
 * Moves billable submissions onto the CO they were just linked to (`target`).
 * For each linked submission that is billable and already sits on another CO:
 * it's pulled out of that CO's manual links, and if that other CO was
 * auto-added for it (sourceRecordId) the CO is removed from the list — unless
 * it still carries other linked submissions, in which case it's kept and only
 * detached from this submission.
 */
async function moveBillableSubmissionsToCo(target, linkedIds, user) {
  if (!linkedIds.length) return;
  const billable = await Record.find({ legacyId: { $in: linkedIds }, billable: "Yes" }).select("legacyId").lean();
  const billableIds = billable.map((r) => r.legacyId);
  if (!billableIds.length) return;

  const others = await ChangeOrder.find({
    _id: { $ne: target._id },
    $or: [{ linkedSubmissionIds: { $in: billableIds } }, { sourceRecordId: { $in: billableIds } }],
  });
  for (const co of others) {
    const remaining = (co.linkedSubmissionIds || []).filter((id) => !billableIds.includes(id));
    const isAutoSource = co.sourceRecordId != null && billableIds.includes(co.sourceRecordId);
    if (isAutoSource && !remaining.length) {
      await ChangeOrder.deleteOne({ _id: co._id });
      writeLog("DELETE-CHANGE-ORDER", `Change Order #${co.coNumber} (${co.changeType}) replaced by link to CO #${target.coNumber}`, user, co.project);
      continue;
    }
    co.linkedSubmissionIds = remaining;
    if (isAutoSource) co.sourceRecordId = null;
    co.updatedBy = user;
    co.updatedAt = new Date();
    await co.save();
  }
}

/** Marks every submission tied to a CO (manual links + auto-add source) as Invoice Released = Yes. */
async function releaseLinkedRecordInvoices(co) {
  const ids = new Set(co.linkedSubmissionIds || []);
  if (co.sourceRecordId != null) ids.add(co.sourceRecordId);
  if (!ids.size) return;
  await Record.updateMany({ legacyId: { $in: [...ids] } }, { $set: { invoiceReleased: "Yes" } });
}

function toRow(co) {
  return {
    id: String(co._id),
    project: co.project,
    co_number: co.coNumber,
    team: co.team || "",
    date: co.date ? statusEngine.fmtDateOnlyISO(co.date) : "",
    change_type: co.changeType || "",
    notes: co.notes || "",
    hours: co.hours ?? 0,
    linked_submission_ids: co.linkedSubmissionIds || [],
    approval: co.approval || "Pending",
    requires_approval: !!co.requiresApproval,
    approval_by: co.approvalBy || "",
    approval_at: co.approvalAt ? new Date(co.approvalAt).toISOString() : "",
    billed: !!co.billed,
    invoice_released: co.invoiceReleased || "",
    invoice_released_reason: co.invoiceReleasedReason || "",
    invoice_released_by: co.invoiceReleasedBy || "",
    invoice_released_at: co.invoiceReleasedAt ? new Date(co.invoiceReleasedAt).toISOString() : "",
    currency: co.currency || "USD",
    amount: co.amount ?? 0,
    total: co.total ?? 0,
    released_to_finance: !!co.releasedToFinance,
    released_to_finance_by: co.releasedToFinanceBy || "",
    released_to_finance_at: co.releasedToFinanceAt ? new Date(co.releasedToFinanceAt).toISOString() : "",
    finance_acknowledged: !!co.financeAcknowledged,
    finance_acknowledged_by: co.financeAcknowledgedBy || "",
    finance_acknowledged_at: co.financeAcknowledgedAt ? new Date(co.financeAcknowledgedAt).toISOString() : "",
    created_by: co.createdBy || "",
    created_at: co.createdAt ? new Date(co.createdAt).toISOString() : "",
    updated_by: co.updatedBy || "",
    updated_at: co.updatedAt ? new Date(co.updatedAt).toISOString() : "",
  };
}

/** GET /api/change-orders?project=X — list a project's change orders, newest first,
 * scoped to the viewer's own team (see filterChangeOrdersForViewer above). Each
 * row also carries `approvers` (who can approve it) and `can_approve` (whether
 * the viewer is one of them — admins always are). */
router.get("/", requireAuth, async (req, res) => {
  const project = String(req.query.project || "").trim();
  if (!project) return res.json({ change_orders: [] });
  const { username, role } = req.session;
  const rows = await ChangeOrder.find({ project }).sort({ createdAt: -1 }).lean();
  const visible = await filterChangeOrdersForViewer(rows, username, role);

  const approversByTeam = new Map();
  const out = [];
  for (const co of visible) {
    const teamKey = (co.team || "").toLowerCase();
    if (!approversByTeam.has(teamKey)) approversByTeam.set(teamKey, await getChangeOrderApprovers(co.team));
    const approvers = approversByTeam.get(teamKey);
    // Admin/management-created COs keep the old rule: any admin/management can set approval.
    const canApprove =
      role === "admin" || (role === "management" && (!co.requiresApproval || approvers.includes(username)));
    out.push({ ...toRow(co), approvers, can_approve: canApprove });
  }
  res.json({ change_orders: out });
});

// A team-lead CO still Pending approval this many days after it was submitted
// shows up on the Reminders page (same threshold as rfis.js's RFI reminders).
const APPROVAL_REMINDER_AFTER_DAYS = 5;

/**
 * GET /api/change-orders/reminders — team-lead COs still Pending approval more
 * than APPROVAL_REMINDER_AFTER_DAYS days since they were submitted (approvalAt
 * is set when a rejected CO is resubmitted, else createdAt). Oldest first.
 * Admins see all; management only the ones they can approve; team leads only
 * their own.
 */
router.get("/reminders", requireRole("admin", "management", "team_lead"), async (req, res) => {
  const { username, role } = req.session;
  const today = statusEngine.todayUTC();
  const cutoff = new Date(today.getTime() - APPROVAL_REMINDER_AFTER_DAYS * 86400000);
  const query = { requiresApproval: true, approval: "Pending" };
  if (role === "team_lead") query.createdBy = username;
  const candidates = await ChangeOrder.find(query).lean();

  const approversByTeam = new Map();
  const reminders = [];
  for (const co of candidates) {
    const since = co.approvalAt || co.createdAt;
    if (!since || since >= cutoff) continue;
    const teamKey = (co.team || "").toLowerCase();
    if (!approversByTeam.has(teamKey)) approversByTeam.set(teamKey, await getChangeOrderApprovers(co.team));
    const approvers = approversByTeam.get(teamKey);
    if (role === "management" && !approvers.includes(username)) continue;
    const sinceDay = statusEngine.parseDate(since);
    reminders.push({
      ...toRow(co),
      approvers,
      pending_since: statusEngine.fmtDateOnlyISO(sinceDay),
      days_pending: statusEngine.daysBetween(today, sinceDay),
    });
  }
  reminders.sort((a, b) => b.days_pending - a.days_pending);
  res.json({ threshold_days: APPROVAL_REMINDER_AFTER_DAYS, reminders });
});

/** Team for a CO created without one: the first linked submission's team, else the
 * project's most recent submission's team, else "" (blank = visible to everyone). */
async function deriveTeam(project, linkedIds) {
  const ids = (linkedIds || []).map(Number).filter(Number.isFinite);
  const query = ids.length ? { legacyId: { $in: ids } } : { project };
  const rec = await Record.findOne(query).sort({ createdAt: -1 }).select("team").lean();
  return rec?.team || "";
}

/** POST /api/change-orders — create a change order (admin/management/team_lead).
 * A team lead's CO is always for their own team, starts Pending and is flagged
 * requiresApproval — see POST /:id/approval for who can approve it. */
router.post("/", requireRole("admin", "management", "team_lead"), async (req, res) => {
  const user = req.session.username;
  const isTl = req.session.role === "team_lead";
  const b = req.body;
  try {
    const project = String(b.project || "").trim();
    const coNumber = String(b.co_number || "").trim();
    const dateRaw = String(b.date || "").trim();
    const changeType = String(b.change_type || "").trim();

    if (!project || !coNumber || !dateRaw || !changeType) {
      return res.status(400).json({ ok: false, error: "Please fill all required fields." });
    }

    const linkedIds = parseLinkedSubmissionIds(b.linked_submission_ids);
    const team = isTl ? user : String(b.team || "").trim() || (await deriveTeam(project, linkedIds));

    const hours = Number(b.hours);
    const hoursVal = Number.isFinite(hours) ? hours : 0;
    const amount = Number(b.amount);
    const amountVal = Number.isFinite(amount) ? amount : 0;
    const co = await ChangeOrder.create({
      project,
      coNumber,
      team,
      date: statusEngine.parseDate(dateRaw),
      changeType,
      notes: String(b.notes || "").trim(),
      hours: hoursVal,
      linkedSubmissionIds: linkedIds,
      approval: !isTl && APPROVAL_VALUES.includes(b.approval) ? b.approval : "Pending",
      requiresApproval: isTl,
      billed: isTl ? false : !!b.billed,
      currency: String(b.currency || "USD").trim() || "USD",
      amount: amountVal,
      total: hoursVal * amountVal,
      createdBy: user,
      createdAt: new Date(),
    });

    // A team lead's CO only takes over billable submissions once it's approved.
    if (!isTl) await moveBillableSubmissionsToCo(co, co.linkedSubmissionIds || [], user);

    let message = `Change Order #${coNumber} created.`;
    if (isTl) {
      const approvers = await getChangeOrderApprovers(team);
      const who = approvers.length ? `${approvers.join(", ")} or an admin` : "an admin";
      message = `Change Order #${coNumber} submitted for approval by ${who}.`;
    }
    writeLog("ADD-CHANGE-ORDER", `project='${project}' co='${coNumber}'${isTl ? " (awaiting approval)" : ""}`, user);
    res.json({ ok: true, message, change_order: toRow(co) });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Error: ${e.message}` });
  }
});

/** PUT /api/change-orders/:id — edit an existing change order (admin/management,
 * or the team lead who raised it while it isn't Approved yet — saving a Rejected
 * one resubmits it as Pending). */
router.put("/:id", requireRole("admin", "management", "team_lead"), async (req, res) => {
  const user = req.session.username;
  const role = req.session.role;
  const isTl = role === "team_lead";
  const b = req.body;
  try {
    const existing = await ChangeOrder.findById(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: "Change order not found." });
    if (isTl && existing.createdBy !== user) {
      return res.status(403).json({ ok: false, error: "You can only edit change orders you created." });
    }
    if (isTl && existing.approval === "Approved") {
      return res.status(403).json({ ok: false, error: "This change order is already approved and can't be edited." });
    }

    const project = String(b.project || "").trim();
    const coNumber = String(b.co_number || "").trim();
    const dateRaw = String(b.date || "").trim();
    const changeType = String(b.change_type || "").trim();

    if (!project || !coNumber || !dateRaw || !changeType) {
      return res.status(400).json({ ok: false, error: "Please fill all required fields." });
    }

    const hours = Number(b.hours);
    const hoursVal = Number.isFinite(hours) ? hours : 0;
    const amount = Number(b.amount);
    const amountVal = Number.isFinite(amount) ? amount : 0;
    // The form no longer has a Team field — only touch `team` if one is sent
    // (never for a team lead: their CO stays on their own team).
    const teamUpdate = !isTl && String(b.team || "").trim() ? { team: String(b.team).trim() } : {};

    // Approval only moves through someone allowed to approve this CO; a team
    // lead's edit always (re)submits it as Pending.
    let approval = existing.approval || "Pending";
    if (isTl) approval = "Pending";
    else if (APPROVAL_VALUES.includes(b.approval) && (!existing.requiresApproval || (await canApproveChangeOrder(user, role, existing.team)))) {
      approval = b.approval;
    }
    const approvalUpdate =
      approval !== (existing.approval || "Pending") ? { approval, approvalBy: user, approvalAt: new Date() } : {};

    existing.set({
      project,
      coNumber,
      ...teamUpdate,
      date: statusEngine.parseDate(dateRaw),
      changeType,
      notes: String(b.notes || "").trim(),
      hours: hoursVal,
      linkedSubmissionIds: parseLinkedSubmissionIds(b.linked_submission_ids),
      ...approvalUpdate,
      billed: isTl ? existing.billed : !!b.billed,
      currency: String(b.currency || "USD").trim() || "USD",
      amount: amountVal,
      total: hoursVal * amountVal,
      updatedBy: user,
      updatedAt: new Date(),
    });
    const co = await existing.save();

    if (!isAwaitingApproval(co)) await moveBillableSubmissionsToCo(co, co.linkedSubmissionIds || [], user);
    // Already-released CO: newly linked submissions follow its released state.
    if (co.invoiceReleased === "Yes") await releaseLinkedRecordInvoices(co);

    writeLog("EDIT-CHANGE-ORDER", `project='${project}' co='${coNumber}'`, user);
    res.json({ ok: true, message: `Change Order #${coNumber} updated.`, change_order: toRow(co) });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Error: ${e.message}` });
  }
});

/** DELETE /api/change-orders/:id — gated by the Settings page's "who can delete
 * change orders" list (settingsService.canDeleteChangeOrders), not a shared password. */
router.delete("/:id", requireAuth, async (req, res) => {
  if (!(await canDeleteChangeOrders(req.session.userId, req.session.role))) {
    return res.status(403).json({ ok: false, error: "You don't have permission to delete change orders." });
  }
  try {
    const co = await ChangeOrder.findByIdAndDelete(req.params.id);
    if (!co) return res.status(404).json({ ok: false, error: "Change order not found." });
    // `project` passed through so the submission detail page's Activity
    // panel can recover this after the document itself is gone (see
    // GET /api/activity-log/project and logging.js's writeLog()).
    writeLog(
      "DELETE-CHANGE-ORDER",
      `Change Order #${co.coNumber} (${co.changeType}) deleted`,
      req.session.username,
      co.project
    );
    res.json({ ok: true, message: `Change Order #${co.coNumber} deleted.` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/change-orders/:id/approval — set approval to Pending/Approved/Rejected.
 * A team lead's CO (requiresApproval) can only be decided by an admin or one of
 * its team's management approvers — management users with that team lead in
 * their allowed teams, or with no teams assigned at all (see
 * userHelpers.getChangeOrderApprovers). Other COs: any admin/management.
 */
router.post("/:id/approval", requireRole("admin", "management"), async (req, res) => {
  const user = req.session.username;
  const approval = String(req.body.approval || "").trim();
  if (!APPROVAL_VALUES.includes(approval)) {
    return res.status(400).json({ ok: false, error: "Invalid approval value." });
  }
  try {
    const existing = await ChangeOrder.findById(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: "Change order not found." });
    if (existing.requiresApproval && !(await canApproveChangeOrder(user, req.session.role, existing.team))) {
      return res.status(403).json({ ok: false, error: "You're not an approver for this team's change orders." });
    }

    existing.set({ approval, approvalBy: user, approvalAt: new Date(), updatedBy: user, updatedAt: new Date() });
    const co = await existing.save();
    if (co.requiresApproval && approval === "Approved") {
      await moveBillableSubmissionsToCo(co, co.linkedSubmissionIds || [], user);
    }
    writeLog("CHANGE-ORDER-APPROVAL", `co='${co.coNumber}' approval='${approval}'`, user, co.project);
    res.json({ ok: true, approval, change_order: toRow(co) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** POST /api/change-orders/:id/billed — set the billed flag (admin/management only). */
router.post("/:id/billed", requireRole("admin", "management"), async (req, res) => {
  const billed = !!req.body.billed;
  try {
    const co = await ChangeOrder.findByIdAndUpdate(
      req.params.id,
      { billed, updatedBy: req.session.username, updatedAt: new Date() },
      { new: true }
    );
    if (!co) return res.status(404).json({ ok: false, error: "Change order not found." });
    writeLog("CHANGE-ORDER-BILLED", `co='${co.coNumber}' billed='${billed}'`, req.session.username);
    res.json({ ok: true, billed });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * The submissions a CO is tied to — its auto-add source (sourceRecordId) plus
 * whatever was manually linked (linkedSubmissionIds) — that aren't yet
 * Completed (same "completed"/"completed_overdue" tag statusEngine.computeStatus
 * gives the submissions list). Empty when the CO has no related submissions
 * at all, since there's nothing to block on.
 */
async function getIncompleteLinkedSubmissions(co) {
  const ids = new Set(co.linkedSubmissionIds || []);
  if (co.sourceRecordId != null) ids.add(co.sourceRecordId);
  if (!ids.size) return [];

  const records = await Record.find({ legacyId: { $in: [...ids] } })
    .select("legacyId submissionName status dueDate")
    .lean();
  return records
    .filter((r) => !statusEngine.computeStatus(r.dueDate, r.status).tag.startsWith("completed"))
    .map((r) => ({ id: r.legacyId, name: r.submissionName || "" }));
}

/**
 * POST /api/change-orders/:id/invoice-released — set "" | "Yes" | "No", with
 * a required reason whenever the value is "No" (surfaced on the Management
 * Dashboard's Yes/No lists). Permission-gated the same way as Record's
 * Invoice Released field — see settingsService.canEditInvoiceReleased — not
 * a role check, since a non-management user can be individually granted
 * this via the Settings page.
 *
 * Setting it to "Yes" also auto-releases the CO to Finance (if it hasn't
 * been already) — an invoice can't really be released before finance has
 * it, so the two workflows would otherwise drift out of sync waiting on a
 * separate manual "Release" click for something that's already happened.
 * That auto-release (and the Yes itself) is blocked while any submission the
 * CO is tied to isn't yet Completed — see getIncompleteLinkedSubmissions.
 */
router.post("/:id/invoice-released", requireAuth, async (req, res) => {
  const allowed = await canEditInvoiceReleased(req.session.userId, req.session.role);
  if (!allowed) return res.status(403).json({ ok: false, error: "Permission denied" });

  const value = String(req.body.invoice_released ?? "").trim();
  if (!["", "Yes", "No"].includes(value)) {
    return res.status(400).json({ ok: false, error: "Invalid invoice released value." });
  }
  const reason = String(req.body.reason || "").trim();
  if (value === "No" && !reason) {
    return res.status(400).json({ ok: false, error: "A reason is required when Invoice Released is No." });
  }

  try {
    const existing = await ChangeOrder.findById(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: "Change order not found." });

    if (value === "Yes" && isAwaitingApproval(existing)) {
      return res.status(400).json({ ok: false, error: AWAITING_APPROVAL_ERROR });
    }
    if (value === "Yes") {
      const incomplete = await getIncompleteLinkedSubmissions(existing);
      if (incomplete.length) {
        return res.status(400).json({
          ok: false,
          error: `Invoice can't be released — ${incomplete.length} linked submission${incomplete.length > 1 ? "s are" : " is"} not completed yet.`,
          incomplete_submissions: incomplete,
        });
      }
    }

    const update = {
      invoiceReleased: value,
      invoiceReleasedReason: value === "No" ? reason : "",
      invoiceReleasedBy: req.session.username,
      invoiceReleasedAt: new Date(),
      updatedBy: req.session.username,
      updatedAt: new Date(),
    };
    const autoReleasedToFinance = value === "Yes" && !existing.releasedToFinance;
    if (autoReleasedToFinance) {
      update.releasedToFinance = true;
      update.releasedToFinanceBy = req.session.username;
      update.releasedToFinanceAt = new Date();
    }

    const co = await ChangeOrder.findByIdAndUpdate(req.params.id, update, { new: true });
    if (value === "Yes") await releaseLinkedRecordInvoices(co);

    writeLog(
      "CHANGE-ORDER-INVOICE-RELEASED",
      `co='${co.coNumber}' invoice_released='${value || "(not set)"}'${value === "No" ? ` reason='${reason}'` : ""}`,
      req.session.username
    );
    if (autoReleasedToFinance) {
      writeLog(
        "CHANGE-ORDER-RELEASE-TO-FINANCE",
        `co='${co.coNumber}' released_to_finance='true' (auto, invoice released)`,
        req.session.username
      );
    }
    res.json({ ok: true, change_order: toRow(co) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/change-orders/:id/release-to-finance — hands a CO off to the
 * Finance dashboard (admin/management only, a plain role split rather than
 * a Settings permission list). Un-releasing (released:false) also clears any
 * finance acknowledgement, since an unreleased CO has nothing to acknowledge.
 */
router.post("/:id/release-to-finance", requireRole("admin", "management"), async (req, res) => {
  const released = !!req.body.released;
  try {
    if (released) {
      const existing = await ChangeOrder.findById(req.params.id).select("requiresApproval approval").lean();
      if (!existing) return res.status(404).json({ ok: false, error: "Change order not found." });
      if (isAwaitingApproval(existing)) return res.status(400).json({ ok: false, error: AWAITING_APPROVAL_ERROR });
    }
    const update = {
      releasedToFinance: released,
      releasedToFinanceBy: req.session.username,
      releasedToFinanceAt: new Date(),
      updatedBy: req.session.username,
      updatedAt: new Date(),
    };
    if (!released) {
      update.financeAcknowledged = false;
      update.financeAcknowledgedBy = "";
      update.financeAcknowledgedAt = null;
    }
    const co = await ChangeOrder.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!co) return res.status(404).json({ ok: false, error: "Change order not found." });

    writeLog(
      "CHANGE-ORDER-RELEASE-TO-FINANCE",
      `co='${co.coNumber}' released_to_finance='${released}'`,
      req.session.username
    );
    res.json({ ok: true, change_order: toRow(co) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/change-orders/:id/finance-acknowledge — Finance (or admin)
 * acknowledges a CO already released to finance. Feeds back onto the
 * Management Dashboard's own Acknowledged column.
 */
router.post("/:id/finance-acknowledge", requireRole("admin", "finance"), async (req, res) => {
  try {
    const existing = await ChangeOrder.findById(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: "Change order not found." });
    if (!existing.releasedToFinance) {
      return res.status(400).json({ ok: false, error: "This change order hasn't been released to finance yet." });
    }

    const acknowledged = req.body.acknowledged === undefined ? true : !!req.body.acknowledged;
    const co = await ChangeOrder.findByIdAndUpdate(
      req.params.id,
      {
        financeAcknowledged: acknowledged,
        financeAcknowledgedBy: req.session.username,
        financeAcknowledgedAt: new Date(),
      },
      { new: true }
    );

    writeLog(
      "CHANGE-ORDER-FINANCE-ACKNOWLEDGE",
      `co='${co.coNumber}' finance_acknowledged='${acknowledged}'`,
      req.session.username
    );
    res.json({ ok: true, change_order: toRow(co) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** GET /api/change-orders/backfill-team — admin only, one-off repair: fill in `team`
 * (added after these rows existed) on auto-added COs from their source record. Manually
 * created COs have no source record to pull a team from — left blank (visible to
 * everyone until someone edits them in with a team). */
router.get("/backfill-team", requireRole("admin"), async (req, res) => {
  try {
    const missing = await ChangeOrder.find({
      team: { $in: [null, ""] },
      sourceRecordId: { $ne: null },
    }).lean();
    let updated = 0;
    for (const co of missing) {
      const record = await Record.findOne({ legacyId: co.sourceRecordId }).select("team").lean();
      if (record && record.team) {
        await ChangeOrder.updateOne({ _id: co._id }, { team: record.team });
        updated++;
      }
    }
    writeLog("BACKFILL-CO-TEAM", `Updated ${updated} change_orders rows`, req.session.username);
    res.type("text").send(`Backfill done. Updated ${updated} rows.`);
  } catch (e) {
    res.type("text").status(500).send(`Error: ${e.message}`);
  }
});

module.exports = router;
