"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import StatPill from "../../components/StatPill";
import SearchableDropdown from "../../components/SearchableDropdown";
import { useAuth } from "../../lib/AuthContext";
import { useFinanceDashboardChangeOrders, useAcknowledgeFinance } from "../../hooks/useFinanceDashboard";
import { ApiError } from "../../lib/api";
import { useToast } from "../../lib/ToastContext";

// "not_acknowledged" (not "") is its own token because the api.js fetch
// wrapper strips any query param whose value is "" — same convention as the
// Management Dashboard's STATUS_FILTERS.
const STATUS_FILTERS = [
  { key: "all", label: "All Released COs", color: undefined },
  { key: "acknowledged", label: "Acknowledged", color: "#198754" },
  { key: "not_acknowledged", label: "Not Acknowledged", color: "#6c757d" },
];

/**
 * Finance Dashboard — every Change Order the Management Dashboard has
 * Released to Finance, with an Acknowledge action. Acknowledging here feeds
 * straight back onto the Management Dashboard's own Acknowledged column
 * (both invalidate the same ["management-dashboard"]/["finance-dashboard"]
 * query keys — see hooks/useFinanceDashboard.js).
 */
export default function FinanceDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const canSeeDashboard = !!user && ["admin", "finance"].includes(user.role);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    } else if (!canSeeDashboard) {
      router.replace("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isFetching } = useFinanceDashboardChangeOrders({
    page,
    status: statusFilter === "all" ? undefined : statusFilter,
    project: projectFilter || undefined,
    search: search || undefined,
  });
  const acknowledge = useAcknowledgeFinance();

  const changeOrders = data?.change_orders || [];
  const projectOptions = data?.projects || [];
  const summary = data?.summary || { total: 0, acknowledged: 0, not_acknowledged: 0 };

  function selectStatus(key) {
    setStatusFilter(key);
    setPage(1);
  }
  function selectProject(name) {
    setProjectFilter(name);
    setPage(1);
  }
  function updateSearch(value) {
    setSearch(value);
    setPage(1);
  }

  async function handleAcknowledge(co) {
    try {
      await acknowledge.mutateAsync({ id: co.id, acknowledged: true });
      toast.success(`CO${co.co_number} acknowledged.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to acknowledge.");
    }
  }

  if (loading || !user || !canSeeDashboard) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: "100vh" }}>
        <div className="spinner-border text-secondary" role="status" />
      </div>
    );
  }

  return (
    <AppLayout>
      <PageHero
        theme="navy"
        icon="bi-cash-coin"
        title="Finance Dashboard"
        meta="Change Orders released to finance from the Management Dashboard"
      />

      <div className="d-flex flex-wrap gap-3 mb-3">
        {STATUS_FILTERS.map((f) => (
          <StatPill
            key={f.key}
            num={f.key === "all" ? summary.total : f.key === "acknowledged" ? summary.acknowledged : summary.not_acknowledged}
            label={f.label}
            color={f.color}
            active={statusFilter === f.key}
            onClick={() => selectStatus(f.key)}
          />
        ))}
      </div>

      <div className="row g-2 mb-3">
        <div className="col-md-4">
          <label className="form-label small mb-1">Project</label>
          <SearchableDropdown value={projectFilter} onChange={selectProject} options={projectOptions} placeholder="All projects" />
        </div>
        <div className="col-md-4">
          <label className="form-label small mb-1">Search (CO # or Project)</label>
          <input className="form-control" value={search} onChange={(e) => updateSearch(e.target.value)} placeholder="e.g. 001 or Acme Tower" />
        </div>
      </div>

      <div className="table-wrap theme-navyblue">
        <table className="table table-hover align-middle mb-0">
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              <th>CO #</th>
              <th>Date</th>
              <th>Change Type</th>
              <th>Hours</th>
              <th>Rate</th>
              <th>Total</th>
              <th>Released</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {changeOrders.map((co) => (
              <tr key={co.id}>
                <td><a href={`/projects/${encodeURIComponent(co.project)}`}>{co.project}</a></td>
                <td>{co.client || "—"}</td>
                <td className="fw-semibold">CO{co.co_number}</td>
                <td className="text-nowrap">{co.date || "—"}</td>
                <td>{co.change_type || "—"}</td>
                <td>{Number(co.hours ?? 0).toFixed(2)}</td>
                <td className="text-nowrap">{co.currency || "USD"} {Number(co.amount ?? 0).toFixed(2)}</td>
                <td className="text-nowrap fw-semibold">{co.currency || "USD"} {Number(co.total ?? 0).toFixed(2)}</td>
                <td>
                  <div className="small fw-semibold">{co.released_to_finance_by || "—"}</div>
                  <div className="small text-muted text-nowrap">{fmtDateTime(co.released_to_finance_at)}</div>
                </td>
                <td>
                  <AcknowledgeCell co={co} onAcknowledge={() => handleAcknowledge(co)} acknowledging={acknowledge.isPending} />
                </td>
              </tr>
            ))}
            {!changeOrders.length && !isFetching && (
              <tr>
                <td colSpan={10} className="text-center text-muted py-4">
                  No Change Orders have been released to finance yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.pages > 1 && (
        <nav className="mt-2">
          <ul className="pagination pagination-sm">
            <li className={`page-item${page <= 1 ? " disabled" : ""}`}>
              <button className="page-link" onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            </li>
            {Array.from({ length: data.pages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === data.pages || Math.abs(p - page) <= 2)
              .map((p, idx, arr) => (
                <span key={p} style={{ display: "contents" }}>
                  {idx > 0 && arr[idx - 1] !== p - 1 && <li className="page-item disabled"><span className="page-link">…</span></li>}
                  <li className={`page-item${p === page ? " active" : ""}`}>
                    <button className="page-link" onClick={() => setPage(p)}>{p}</button>
                  </li>
                </span>
              ))}
            <li className={`page-item${page >= data.pages ? " disabled" : ""}`}>
              <button className="page-link" onClick={() => setPage((p) => Math.min(data.pages, p + 1))}>Next</button>
            </li>
          </ul>
        </nav>
      )}
    </AppLayout>
  );
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Acknowledged status and the Acknowledge action live in one cell — the
 * action only ever applies while not yet acknowledged, so a separate
 * always-visible column for it left most rows blank. */
function AcknowledgeCell({ co, onAcknowledge, acknowledging }) {
  if (co.finance_acknowledged) {
    return (
      <span className="badge bg-success" title={co.finance_acknowledged_by ? `By ${co.finance_acknowledged_by}` : ""}>
        <i className="bi bi-check-lg" /> Acknowledged
      </span>
    );
  }
  return (
    <button className="btn btn-sm btn-outline-success" disabled={acknowledging} onClick={onAcknowledge}>
      <i className="bi bi-check2" /> Acknowledge
    </button>
  );
}
