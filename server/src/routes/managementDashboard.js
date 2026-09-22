const createSafeRouter = require("../utils/safeRouter");
const { ChangeOrder, Project } = require("../models");
const { requireAuth } = require("../middleware/auth");
const { canViewManagementDashboard } = require("../services/settingsService");
const statusEngine = require("../services/statusEngine");

const router = createSafeRouter();

// Mirrors the client's lib/changeOrderStatus.js getChangeOrderStatus() so the
// `co_status` filter matches exactly what the Status column/pill shows.
function coStatusKey(co) {
  if (co.finance_acknowledged) return "finance";
  if (co.released_to_finance) return "sent";
  return "pending";
}

// Rank rather than plain alphabetical, so ascending actually reads as the
// real lifecycle/workflow order instead of an arbitrary string sort.
const CO_STATUS_RANK = { pending: 0, sent: 1, finance: 2 };
const INVOICE_RELEASED_RANK = { "": 0, No: 1, Yes: 2 };

// `sort_by` accepts any of these keys (see GET /change-orders below); each
// value pulls the field to compare from an already-shaped row.
const SORTABLE_FIELDS = {
  project: (c) => c.project || "",
  client: (c) => c.client || "",
  co_number: (c) => c.co_number || "",
  date: (c) => c.date || "",
  change_type: (c) => c.change_type || "",
  hours: (c) => Number(c.hours) || 0,
  amount: (c) => Number(c.amount) || 0,
  total: (c) => Number(c.total) || 0,
  status: (c) => CO_STATUS_RANK[coStatusKey(c)] ?? 0,
  invoice_released: (c) => INVOICE_RELEASED_RANK[c.invoice_released || ""] ?? 0,
};

function applySort(rows, sortBy, sortDir) {
  const getVal = SORTABLE_FIELDS[sortBy];
  if (!getVal) return rows;
  const dir = sortDir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = getVal(a);
    const vb = getVal(b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

function toRow(co, clientByProject) {
  return {
    id: String(co._id),
    project: co.project,
    client: clientByProject.get(co.project) || "",
    co_number: co.coNumber,
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

/**
 * GET /api/management-dashboard/change-orders — every Change Order across
 * every project (not scoped to one, unlike GET /api/change-orders), for the
 * cross-project Management Dashboard. Visible to admin/management, plus
 * anyone granted the "Invoice Released" edit permission on the Settings page
 * even if their role is something else — see settingsService.canViewManagementDashboard.
 * Editing the invoice_released field itself still goes through
 * POST /api/change-orders/:id/invoice-released, which re-checks the edit
 * permission independently.
 *
 * Paginated + filtered server-side, mirroring GET /api/records: `page`,
 * `status` ("Yes" | "No" | "not_set" — "" is reserved by the client's fetch
 * wrapper for "omit this param", so "not set" needs its own token), `co_status`
 * ("pending" | "sent" | "finance" — the CO lifecycle Status column/pill, a
 * separate dimension from Invoice Released), `project`, `client`, `date_from`/
 * `date_to` (inclusive, matched against the CO's own Date field, both
 * YYYY-MM-DD), `search` (matches CO #, project name, or Change Type),
 * `sort_by`/`sort_dir` (any SORTABLE_FIELDS key, "asc" | "desc" — clicking a
 * column header; defaults to the Finance-Approved-sinks-to-the-bottom
 * ordering below when omitted). `summary`/`projects`/`clients` are always
 * computed over the *full*, unfiltered set — the stat pills and the
 * project/client filters' option lists must stay stable as the table itself
 * is filtered/paged.
 */
router.get("/change-orders", requireAuth, async (req, res) => {
  const allowed = await canViewManagementDashboard(req.session.userId, req.session.role);
  if (!allowed) return res.status(403).json({ ok: false, error: "Permission denied" });

  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const statusFilter = String(req.query.status || "").trim();
  const coStatusFilter = String(req.query.co_status || "").trim();
  const projectFilter = String(req.query.project || "").trim();
  const clientFilter = String(req.query.client || "").trim();
  const dateFrom = String(req.query.date_from || "").trim();
  const dateTo = String(req.query.date_to || "").trim();
  const search = String(req.query.search || "").trim().toLowerCase();
  const sortBy = String(req.query.sort_by || "").trim();
  const sortDir = String(req.query.sort_dir || "").trim().toLowerCase() === "desc" ? "desc" : "asc";

  const [rows, projects] = await Promise.all([
    ChangeOrder.find({}).sort({ createdAt: -1 }).lean(),
    Project.find({}).select("name client").lean(),
  ]);
  const clientByProject = new Map(projects.map((p) => [p.name, p.client || ""]));
  const allChangeOrders = rows.map((co) => toRow(co, clientByProject));

  const summary = {
    total: allChangeOrders.length,
    released_yes: allChangeOrders.filter((c) => c.invoice_released === "Yes").length,
    released_no: allChangeOrders.filter((c) => c.invoice_released === "No").length,
    not_set: allChangeOrders.filter((c) => !c.invoice_released).length,
  };
  const projectNames = [...new Set(allChangeOrders.map((c) => c.project))].sort();
  const clientNames = [...new Set(allChangeOrders.map((c) => c.client).filter(Boolean))].sort();

  let filtered = allChangeOrders;
  if (statusFilter === "not_set") filtered = filtered.filter((c) => !c.invoice_released);
  else if (statusFilter === "Yes" || statusFilter === "No") filtered = filtered.filter((c) => c.invoice_released === statusFilter);
  if (["pending", "sent", "finance"].includes(coStatusFilter)) filtered = filtered.filter((c) => coStatusKey(c) === coStatusFilter);
  if (projectFilter) filtered = filtered.filter((c) => c.project === projectFilter);
  if (clientFilter) filtered = filtered.filter((c) => c.client === clientFilter);
  if (dateFrom) filtered = filtered.filter((c) => c.date && c.date >= dateFrom);
  if (dateTo) filtered = filtered.filter((c) => c.date && c.date <= dateTo);
  if (search) filtered = filtered.filter((c) => `${c.project} ${c.co_number} ${c.change_type}`.toLowerCase().includes(search));

  if (SORTABLE_FIELDS[sortBy]) {
    filtered = applySort(filtered, sortBy, sortDir);
  } else {
    // Default ordering: Finance Approved (finance_acknowledged) COs are done —
    // sink them to the bottom so the actionable ones (Pending/Sent to
    // Finance) stay on top. Array.prototype.sort is stable, so the
    // createdAt-desc order from the query above is preserved within each
    // group.
    filtered = [...filtered].sort((a, b) => (a.finance_acknowledged === b.finance_acknowledged ? 0 : a.finance_acknowledged ? 1 : -1));
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const start = (pageClamped - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  res.json({
    change_orders: pageRows,
    projects: projectNames,
    clients: clientNames,
    summary,
    total,
    page: pageClamped,
    pages: totalPages,
    page_size: PAGE_SIZE,
  });
});

module.exports = router;
