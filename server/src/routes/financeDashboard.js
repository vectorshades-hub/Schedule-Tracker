const createSafeRouter = require("../utils/safeRouter");
const { ChangeOrder, Project } = require("../models");
const { requireRole } = require("../middleware/auth");
const statusEngine = require("../services/statusEngine");

const router = createSafeRouter();

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
 * ("acknowledged" | "not_acknowledged"), `project`, `search`.
 */
router.get("/change-orders", requireRole("admin", "finance"), async (req, res) => {
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const statusFilter = String(req.query.status || "").trim();
  const projectFilter = String(req.query.project || "").trim();
  const search = String(req.query.search || "").trim().toLowerCase();

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

  let filtered = allChangeOrders;
  if (statusFilter === "acknowledged") filtered = filtered.filter((c) => c.finance_acknowledged);
  else if (statusFilter === "not_acknowledged") filtered = filtered.filter((c) => !c.finance_acknowledged);
  if (projectFilter) filtered = filtered.filter((c) => c.project === projectFilter);
  if (search) filtered = filtered.filter((c) => `${c.project} ${c.co_number}`.toLowerCase().includes(search));

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const start = (pageClamped - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  res.json({
    change_orders: pageRows,
    projects: projectNames,
    summary,
    total,
    page: pageClamped,
    pages: totalPages,
    page_size: PAGE_SIZE,
  });
});

module.exports = router;
