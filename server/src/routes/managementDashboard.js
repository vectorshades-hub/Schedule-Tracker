const createSafeRouter = require("../utils/safeRouter");
const { ChangeOrder, Project } = require("../models");
const { requireAuth } = require("../middleware/auth");
const { canViewManagementDashboard } = require("../services/settingsService");
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
    approval: co.approval || "Pending",
    billed: !!co.billed,
    invoice_released: co.invoiceReleased || "",
    invoice_released_reason: co.invoiceReleasedReason || "",
    invoice_released_by: co.invoiceReleasedBy || "",
    invoice_released_at: co.invoiceReleasedAt ? new Date(co.invoiceReleasedAt).toISOString() : "",
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
 * wrapper for "omit this param", so "not set" needs its own token), `project`,
 * `search` (matches CO # or project name). `summary`/`projects` are always
 * computed over the *full*, unfiltered set — the stat pills and the project
 * filter's option list must stay stable as the table itself is filtered/paged.
 */
router.get("/change-orders", requireAuth, async (req, res) => {
  const allowed = await canViewManagementDashboard(req.session.userId, req.session.role);
  if (!allowed) return res.status(403).json({ ok: false, error: "Permission denied" });

  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const statusFilter = String(req.query.status || "").trim();
  const projectFilter = String(req.query.project || "").trim();
  const search = String(req.query.search || "").trim().toLowerCase();

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

  let filtered = allChangeOrders;
  if (statusFilter === "not_set") filtered = filtered.filter((c) => !c.invoice_released);
  else if (statusFilter === "Yes" || statusFilter === "No") filtered = filtered.filter((c) => c.invoice_released === statusFilter);
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
