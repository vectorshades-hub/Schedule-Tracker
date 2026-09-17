const mongoose = require("mongoose");

/**
 * Change Orders are project-level (not tied to one specific submission) —
 * scoped by `project` name, same grouping the app already uses for the
 * project drilldown/lifecycle pages, so a CO created from any submission
 * under a project shows up for all of that project's submissions.
 */
const changeOrderSchema = new mongoose.Schema({
  project: { type: String, required: true, index: true },
  coNumber: { type: String, required: true }, // e.g. "001" — free text, not auto-numbered
  // The team this CO belongs to (a team-lead/management username, same values
  // Record.team uses) — drives the project page's team-scoped visibility (see
  // routes/changeOrders.js's filterChangeOrdersForViewer). Blank means
  // "unattributed" (legacy data, or a manual CO nobody has assigned yet) and
  // stays visible to everyone rather than disappearing.
  team: { type: String, default: "" },
  date: { type: Date, default: null },
  changeType: { type: String, default: "" }, // "Change" field — select-or-type, no fixed enum
  notes: { type: String, default: "" },
  hours: { type: Number, default: 0 },
  approval: { type: String, default: "Pending" }, // "Pending" | "Approved" | "Rejected"
  billed: { type: Boolean, default: false },
  createdBy: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  // Bumped by any edit/approval-decision/billed-toggle — feeds the
  // submission detail page's Activity panel ("Change Order updated").
  updatedBy: { type: String, default: "" },
  updatedAt: { type: Date, default: null },
  // Set only on a CO auto-added because its source submission was marked
  // Billable (Record.legacyId — see routes/records.js's ensureBillableChangeOrder) —
  // null for every manually-created CO. Lets that auto-add stay idempotent:
  // toggling Billable off and back on, or re-saving an already-billable
  // submission, checks this before adding a second CO for the same submission.
  sourceRecordId: { type: Number, default: null, index: true },
  // Management Dashboard's Invoice Released field — "" | "Yes" | "No", same
  // convention as Record.invoiceReleased, gated by the same
  // settingsService.canEditInvoiceReleased permission. `invoiceReleasedReason`
  // is required (enforced in routes/changeOrders.js) whenever the value is
  // "No", and cleared again whenever it isn't.
  invoiceReleased: { type: String, default: "" },
  invoiceReleasedReason: { type: String, default: "" },
  invoiceReleasedBy: { type: String, default: "" },
  invoiceReleasedAt: { type: Date, default: null },
  // Currency/Amount/Total — Amount is a rate, Total is always server-computed
  // as hours * amount (see routes/changeOrders.js) rather than typed in
  // directly, so it can never drift out of sync with Hours/Amount edits.
  currency: { type: String, default: "USD" },
  amount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  // Separate from the Invoice Released workflow above — Release to Finance
  // hands a CO off to the finance role's own dashboard (routes/financeDashboard.js),
  // which then acknowledges it. Gated by requireRole("admin","management") /
  // requireRole("admin","finance") in routes/changeOrders.js, not a Settings
  // permission list, since it's a plain role split rather than a per-user grant.
  releasedToFinance: { type: Boolean, default: false },
  releasedToFinanceBy: { type: String, default: "" },
  releasedToFinanceAt: { type: Date, default: null },
  financeAcknowledged: { type: Boolean, default: false },
  financeAcknowledgedBy: { type: String, default: "" },
  financeAcknowledgedAt: { type: Date, default: null },
});

module.exports = mongoose.model("ChangeOrder", changeOrderSchema);
