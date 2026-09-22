"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import StatPill from "../../components/StatPill";
import SearchableDropdown from "../../components/SearchableDropdown";
import SortableTh from "../../components/SortableTh";
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

// The Status dropdown below mirrors the pills above (same statusFilter
// state, just a second way to pick it) — excludes "all", since that's what
// an empty/cleared dropdown value already means.
const STATUS_DROPDOWN_OPTIONS = STATUS_FILTERS.filter((f) => f.key !== "all").map((f) => f.label);
const STATUS_LABEL_BY_KEY = Object.fromEntries(STATUS_FILTERS.map((f) => [f.key, f.label]));
const STATUS_KEY_BY_LABEL = Object.fromEntries(STATUS_FILTERS.map((f) => [f.label, f.key]));

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
  const [clientFilter, setClientFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const { data, isFetching } = useFinanceDashboardChangeOrders({
    page,
    status: statusFilter === "all" ? undefined : statusFilter,
    project: projectFilter || undefined,
    client: clientFilter || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    search: search || undefined,
    sort_by: sortBy || undefined,
    sort_dir: sortDir,
  });
  const acknowledge = useAcknowledgeFinance();

  const changeOrders = data?.change_orders || [];
  const projectOptions = data?.projects || [];
  const clientOptions = data?.clients || [];
  const summary = data?.summary || { total: 0, acknowledged: 0, not_acknowledged: 0 };

  function selectStatus(key) {
    setStatusFilter(key);
    setPage(1);
  }
  function selectStatusFromDropdown(label) {
    selectStatus(label ? STATUS_KEY_BY_LABEL[label] || "all" : "all");
  }
  function selectProject(name) {
    setProjectFilter(name);
    setPage(1);
  }
  function selectClient(name) {
    setClientFilter(name);
    setPage(1);
  }
  function updateSearch(value) {
    setSearch(value);
    setPage(1);
  }
  function updateDateRange({ from, to }) {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  }
  const hasActiveFilters = statusFilter !== "all" || !!projectFilter || !!clientFilter || !!search || !!dateFrom || !!dateTo;
  function clearFilters() {
    setStatusFilter("all");
    setProjectFilter("");
    setClientFilter("");
    setDateFrom("");
    setDateTo("");
    setSearch("");
    setPage(1);
  }
  function handleSort(field) {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
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

      <div className="row g-2 mb-2">
        <div className="col-md-3">
          <label className="form-label small mb-1">Project</label>
          <SearchableDropdown value={projectFilter} onChange={selectProject} options={projectOptions} placeholder="All projects" />
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-1">Client</label>
          <SearchableDropdown value={clientFilter} onChange={selectClient} options={clientOptions} placeholder="All clients" />
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-1">Status</label>
          <SearchableDropdown
            value={statusFilter === "all" ? "" : STATUS_LABEL_BY_KEY[statusFilter] || ""}
            onChange={selectStatusFromDropdown}
            options={STATUS_DROPDOWN_OPTIONS}
            placeholder="All statuses"
          />
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-1">Search (CO #, Project, or Change Type)</label>
          <input className="form-control" value={search} onChange={(e) => updateSearch(e.target.value)} placeholder="e.g. 001, Acme Tower, or Scope Addition" />
        </div>
      </div>

      <div className="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-3">
        <div>
          <label className="form-label small mb-1">Date</label>
          <div className={`date-range-inline${dateFrom || dateTo ? " active" : ""}`}>
            <i className="bi bi-calendar3 date-range-icon" />
            <input
              type="date"
              className="date-range-input"
              value={dateFrom}
              onChange={(e) => updateDateRange({ from: e.target.value, to: dateTo })}
              aria-label="From date"
            />
            <i className="bi bi-arrow-right date-range-sep" />
            <i className="bi bi-calendar3 date-range-icon" />
            <input
              type="date"
              className="date-range-input"
              value={dateTo}
              onChange={(e) => updateDateRange({ from: dateFrom, to: e.target.value })}
              aria-label="To date"
            />
            {(dateFrom || dateTo) && (
              <button type="button" className="date-range-clear" onClick={() => updateDateRange({ from: "", to: "" })} aria-label="Clear date range">
                <i className="bi bi-x-lg" />
              </button>
            )}
          </div>
        </div>
        {hasActiveFilters && (
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearFilters}>
            <i className="bi bi-x-circle" /> Clear
          </button>
        )}
      </div>

      <div className="table-wrap theme-navyblue">
        <table className="table table-hover align-middle mb-0">
          <thead>
            <tr>
              <SortableTh field="project" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Project</SortableTh>
              <SortableTh field="client" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Client</SortableTh>
              <SortableTh field="co_number" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>CO #</SortableTh>
              <SortableTh field="date" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Date</SortableTh>
              <SortableTh field="change_type" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Change Type</SortableTh>
              <SortableTh field="hours" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Hours</SortableTh>
              <SortableTh field="amount" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Rate</SortableTh>
              <SortableTh field="total" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Total</SortableTh>
              <SortableTh field="released_to_finance_at" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Released</SortableTh>
              <SortableTh field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Status</SortableTh>
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
