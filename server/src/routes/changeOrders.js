const createSafeRouter = require("../utils/safeRouter");
const { ChangeOrder, Record } = require("../models");
const { requireAuth, requireRole } = require("../middleware/auth");
const { writeLog } = require("../services/logging");
const statusEngine = require("../services/statusEngine");
const { canEditInvoiceReleased, canDeleteChangeOrders } = require("../services/settingsService");
const { teamMatch } = require("../services/recordVisibility");
const { getLinkedTls, getManagementUsersForTeamlead, getAllTeamleadsInManagement } = require("../services/userHelpers");

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
    approval: co.approval || "Pending",
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
 * scoped to the viewer's own team (see filterChangeOrdersForViewer above). */
router.get("/", requireAuth, async (req, res) => {
  const project = String(req.query.project || "").trim();
  if (!project) return res.json({ change_orders: [] });
  const rows = await ChangeOrder.find({ project }).sort({ createdAt: -1 }).lean();
  const visible = await filterChangeOrdersForViewer(rows, req.session.username, req.session.role);
  res.json({ change_orders: visible.map(toRow) });
});

/** POST /api/change-orders — create a change order (admin/management only). */
router.post("/", requireRole("admin", "management"), async (req, res) => {
  const user = req.session.username;
  const b = req.body;
  try {
    const project = String(b.project || "").trim();
    const coNumber = String(b.co_number || "").trim();
    const team = String(b.team || "").trim();
    const dateRaw = String(b.date || "").trim();
    const changeType = String(b.change_type || "").trim();

    if (!project || !coNumber || !team || !dateRaw || !changeType) {
      return res.status(400).json({ ok: false, error: "Please fill all required fields." });
    }

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
      approval: ["Pending", "Approved", "Rejected"].includes(b.approval) ? b.approval : "Pending",
      billed: !!b.billed,
      currency: String(b.currency || "USD").trim() || "USD",
      amount: amountVal,
      total: hoursVal * amountVal,
      createdBy: user,
      createdAt: new Date(),
    });

    writeLog("ADD-CHANGE-ORDER", `project='${project}' co='${coNumber}'`, user);
    res.json({ ok: true, message: `Change Order #${coNumber} created.`, change_order: toRow(co) });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Error: ${e.message}` });
  }
});

/** PUT /api/change-orders/:id — edit an existing change order (admin/management only). */
router.put("/:id", requireRole("admin", "management"), async (req, res) => {
  const user = req.session.username;
  const b = req.body;
  try {
    const project = String(b.project || "").trim();
    const coNumber = String(b.co_number || "").trim();
    const team = String(b.team || "").trim();
    const dateRaw = String(b.date || "").trim();
    const changeType = String(b.change_type || "").trim();

    if (!project || !coNumber || !team || !dateRaw || !changeType) {
      return res.status(400).json({ ok: false, error: "Please fill all required fields." });
    }

    const hours = Number(b.hours);
    const hoursVal = Number.isFinite(hours) ? hours : 0;
    const amount = Number(b.amount);
    const amountVal = Number.isFinite(amount) ? amount : 0;
    const co = await ChangeOrder.findByIdAndUpdate(
      req.params.id,
      {
        project,
        coNumber,
        team,
        date: statusEngine.parseDate(dateRaw),
        changeType,
        notes: String(b.notes || "").trim(),
        hours: hoursVal,
        approval: ["Pending", "Approved", "Rejected"].includes(b.approval) ? b.approval : "Pending",
        billed: !!b.billed,
        currency: String(b.currency || "USD").trim() || "USD",
        amount: amountVal,
        total: hoursVal * amountVal,
        updatedBy: user,
        updatedAt: new Date(),
      },
      { new: true }
    );
    if (!co) return res.status(404).json({ ok: false, error: "Change order not found." });

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

/** POST /api/change-orders/:id/approval — set approval to Pending/Approved/Rejected (admin/management only). */
router.post("/:id/approval", requireRole("admin", "management"), async (req, res) => {
  const approval = String(req.body.approval || "").trim();
  if (!["Pending", "Approved", "Rejected"].includes(approval)) {
    return res.status(400).json({ ok: false, error: "Invalid approval value." });
  }
  try {
    const co = await ChangeOrder.findByIdAndUpdate(
      req.params.id,
      { approval, updatedBy: req.session.username, updatedAt: new Date() },
      { new: true }
    );
    if (!co) return res.status(404).json({ ok: false, error: "Change order not found." });
    writeLog("CHANGE-ORDER-APPROVAL", `co='${co.coNumber}' approval='${approval}'`, req.session.username);
    res.json({ ok: true, approval });
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
