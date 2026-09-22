const createSafeRouter = require("../utils/safeRouter");
const { ChangeOrder, Project } = require("../models");
const { requireRole } = require("../middleware/auth");
const statusEngine = require("../services/statusEngine");

const router = createSafeRouter();

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
  released_to_finance_at: (c) => c.released_to_finance_at || "",
  status: (c) => (c.finance_acknowledged ? 1 : 0),
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
    currency: co.currency || "USD",
    amount: co.amount ?? 0,
    total: co.total ?? 0,
    released_to_finance_by: co.releasedToFinanceBy || "",
    released_to_finance_at: co.releasedToFinanceAt ? new Date(co.releasedToFinanceAt).toISOString() : "",
    finance_acknowledged: !!co.financeAcknowledged,
    finance_acknowledged_by: co.financeAcknowledgedBy || "",
    finance_acknowledged_at: co.financeAcknowledgedAt ? new Date(co.financeAcknowledgedAt).toISOString() : "",
  };
}

/**
 * GET /api/finance-dashboard/change-orders — every Change Order that's been
 * Released to Finance from the Management Dashboard (routes/changeOrders.js's
 * /:id/release-to-finance), across every project. Visible to admin/finance
 * only. Paginated + filtered server-side, same shape as
 * GET /api/management-dashboard/change-orders: `page`, `status`
 * ("acknowledged" | "not_acknowledged"), `project`, `client`, `date_from`/
 * `date_to` (inclusive, matched against the CO's own Date field, both
 * YYYY-MM-DD), `search` (matches CO #, project name, or Change Type),
 * `sort_by`/`sort_dir` (any SORTABLE_FIELDS key, "asc" | "desc" — clicking a
 * column header; defaults to the Acknowledged-sinks-to-the-bottom ordering
 * below when omitted).
 */
router.get("/change-orders", requireRole("admin", "finance"), async (req, res) => {
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const statusFilter = String(req.query.status || "").trim();
  const projectFilter = String(req.query.project || "").trim();
  const clientFilter = String(req.query.client || "").trim();
  const dateFrom = String(req.query.date_from || "").trim();
  const dateTo = String(req.query.date_to || "").trim();
  const search = String(req.query.search || "").trim().toLowerCase();
  const sortBy = String(req.query.sort_by || "").trim();
  const sortDir = String(req.query.sort_dir || "").trim().toLowerCase() === "desc" ? "desc" : "asc";

  const [rows, projects] = await Promise.all([
    ChangeOrder.find({ releasedToFinance: true }).sort({ releasedToFinanceAt: -1 }).lean(),
    Project.find({}).select("name client").lean(),
  ]);
  const clientByProject = new Map(projects.map((p) => [p.name, p.client || ""]));
  const allChangeOrders = rows.map((co) => toRow(co, clientByProject));

  const summary = {
    total: allChangeOrders.length,
    acknowledged: allChangeOrders.filter((c) => c.finance_acknowledged).length,
    not_acknowledged: allChangeOrders.filter((c) => !c.finance_acknowledged).length,
  };
  const projectNames = [...new Set(allChangeOrders.map((c) => c.project))].sort();
  const clientNames = [...new Set(allChangeOrders.map((c) => c.client).filter(Boolean))].sort();

  let filtered = allChangeOrders;
  if (statusFilter === "acknowledged") filtered = filtered.filter((c) => c.finance_acknowledged);
  else if (statusFilter === "not_acknowledged") filtered = filtered.filter((c) => !c.finance_acknowledged);
  if (projectFilter) filtered = filtered.filter((c) => c.project === projectFilter);
  if (clientFilter) filtered = filtered.filter((c) => c.client === clientFilter);
  if (dateFrom) filtered = filtered.filter((c) => c.date && c.date >= dateFrom);
  if (dateTo) filtered = filtered.filter((c) => c.date && c.date <= dateTo);
  if (search) filtered = filtered.filter((c) => `${c.project} ${c.co_number} ${c.change_type}`.toLowerCase().includes(search));

  if (SORTABLE_FIELDS[sortBy]) {
    filtered = applySort(filtered, sortBy, sortDir);
  } else {
    // Default ordering: Acknowledged COs are done — sink them to the bottom
    // so the ones still needing action stay on top. Array.prototype.sort is
    // stable, so the releasedToFinanceAt-desc order from the query above is
    // preserved within each group.
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
