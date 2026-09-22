"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import StatPill from "../../components/StatPill";
import Modal from "../../components/Modal";
import SearchableDropdown from "../../components/SearchableDropdown";
import SortableTh from "../../components/SortableTh";
import { useAuth } from "../../lib/AuthContext";
import { useManagementDashboardChangeOrders, useSetInvoiceReleased } from "../../hooks/useManagementDashboard";
import { ApiError } from "../../lib/api";
import { useToast } from "../../lib/ToastContext";
import { CHANGE_ORDER_STATUSES, getChangeOrderStatus } from "../../lib/changeOrderStatus";

// Maps the Status column's labels (Pending/Sent to Finance/Finance Approved)
// to the `co_status` query param — a separate filter dimension from the
// Invoice Released pills above.
const CO_STATUS_OPTIONS = CHANGE_ORDER_STATUSES.map((s) => s.label);
const CO_STATUS_KEY_BY_LABEL = Object.fromEntries(CHANGE_ORDER_STATUSES.map((s) => [s.label, s.key]));

// "not_set" (not "") is its own token because the api.js fetch wrapper strips
// any query param whose value is "" — sending status="" would be silently
// indistinguishable from omitting the filter entirely.
const STATUS_FILTERS = [
  { key: "all", label: "All CO Submissions", color: undefined },
  { key: "Yes", label: "Invoice Released — Yes", color: "#198754" },
  { key: "No", label: "Invoice Released — No", color: "#dc3545" },
  { key: "not_set", label: "Not Set", color: "#6c757d" },
];

/**
 * Management Dashboard — every Change Order (CO) submission across every
 * project, with the Invoice Released Yes/No/reason workflow. Visible to
 * management/admin, plus anyone individually granted the "Invoice Released"
 * edit permission on the Settings page (see AppLayout's nav-link condition
 * and settingsService.canViewManagementDashboard) — that grant is exactly
 * "needs to see this dashboard to act on it", even for a non-management role.
 */
export default function ManagementDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const canSeeDashboard = !!user && (["admin", "management"].includes(user.role) || user.can_edit_invoice_released);
  const canEdit = !!user?.can_edit_invoice_released;

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
  const [coStatusFilter, setCoStatusFilter] = useState(""); // Status column filter (Pending/Sent to Finance/Finance Approved label, or "" for all
  const [projectFilter, setProjectFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState(null); // the CO row being edited
  const [saveWarning, setSaveWarning] = useState(null); // { message, incomplete: [{id,name}] } — set when the server blocks "Yes" over incomplete linked submissions
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const { data, isFetching } = useManagementDashboardChangeOrders({
    page,
    status: statusFilter === "all" ? undefined : statusFilter,
    co_status: coStatusFilter ? CO_STATUS_KEY_BY_LABEL[coStatusFilter] : undefined,
    project: projectFilter || undefined,
    client: clientFilter || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    search: search || undefined,
    sort_by: sortBy || undefined,
    sort_dir: sortDir,
  });
  const setInvoiceReleased = useSetInvoiceReleased();

  const changeOrders = data?.change_orders || [];
  const projectOptions = data?.projects || [];
  const clientOptions = data?.clients || [];
  const summary = data?.summary || { total: 0, released_yes: 0, released_no: 0, not_set: 0 };

  function selectStatus(key) {
    setStatusFilter(key);
    setPage(1);
  }
  function selectCoStatus(label) {
    setCoStatusFilter(label);
    setPage(1);
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
  const hasActiveFilters = !!coStatusFilter || !!projectFilter || !!clientFilter || !!search || !!dateFrom || !!dateTo;
  function clearFilters() {
    setCoStatusFilter("");
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

  async function handleSave(id, invoiceReleased, reason) {
    const wasReleasedToFinance = !!editTarget?.released_to_finance;
    setSaveWarning(null);
    try {
      const res = await setInvoiceReleased.mutateAsync({ id, invoiceReleased, reason });
      setEditTarget(null);
      const autoReleased = invoiceReleased === "Yes" && !wasReleasedToFinance && res?.change_order?.released_to_finance;
      toast.success(autoReleased ? "Invoice Released updated — CO auto-released to Finance." : "Invoice Released updated.");
    } catch (e) {
      if (e instanceof ApiError && e.data?.incomplete_submissions) {
        setSaveWarning({ message: e.message, incomplete: e.data.incomplete_submissions });
      } else {
        toast.error(e instanceof ApiError ? e.message : "Failed to update Invoice Released.");
      }
    }
  }

  function openInvoiceReleasedModal(co) {
    setSaveWarning(null);
    setEditTarget(co);
  }
  function closeInvoiceReleasedModal() {
    setSaveWarning(null);
    setEditTarget(null);
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
        icon="bi-graph-up-arrow"
        title="Management Dashboard"
        meta="Change Order submissions across all projects — Invoice Released status"
      />

      <div className="d-flex flex-wrap gap-3 mb-3">
        {STATUS_FILTERS.map((f) => (
          <StatPill
            key={f.key}
            num={f.key === "all" ? summary.total : f.key === "Yes" ? summary.released_yes : f.key === "No" ? summary.released_no : summary.not_set}
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
          <SearchableDropdown value={coStatusFilter} onChange={selectCoStatus} options={CO_STATUS_OPTIONS} placeholder="All statuses" />
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
              <SortableTh field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Status</SortableTh>
              <SortableTh field="invoice_released" sortBy={sortBy} sortDir={sortDir} onSort={handleSort}>Invoice Released</SortableTh>
              <th></th>
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
                  <CoStatusCell co={co} />
                </td>
                <td>
                  <InvoiceReleasedBadge value={co.invoice_released} reason={co.invoice_released_reason} />
                </td>
                <td>
                  {canEdit && (
                    <button className="btn btn-sm btn-outline-primary" onClick={() => openInvoiceReleasedModal(co)}>
                      <i className="bi bi-pencil" /> Update
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!changeOrders.length && !isFetching && (
              <tr>
                <td colSpan={11} className="text-center text-muted py-4">
                  No Change Orders match this filter.
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

      <InvoiceReleasedModal
        co={editTarget}
        onClose={closeInvoiceReleasedModal}
        onSave={handleSave}
        saving={setInvoiceReleased.isPending}
        warning={saveWarning}
      />
    </AppLayout>
  );
}

/** Status column — the same 3-state finance lifecycle shown on the project
 * detail page's Change Order cards (see lib/changeOrderStatus). No manual
 * "Release" action here — a CO moves to Sent to Finance automatically as
 * soon as Invoice Released is set to Yes (see routes/changeOrders.js). */
function CoStatusCell({ co }) {
  const status = getChangeOrderStatus(co);
  return (
    <span className={`co-status-pill co-status-${status.key}`}>
      <i className={`bi ${status.icon}`} /> {status.label}
    </span>
  );
}

/** Reason (required whenever Invoice Released is "No") is surfaced as a
 * hover tooltip on the badge rather than its own mostly-empty column. */
function InvoiceReleasedBadge({ value, reason }) {
  if (value === "Yes") return <span className="badge bg-success">Yes</span>;
  if (value === "No")
    return (
      <span className="badge bg-danger" title={reason || "No reason given"}>
        No {reason && <i className="bi bi-info-circle-fill ms-1" />}
      </span>
    );
  return <span className="badge bg-secondary">Not Set</span>;
}

/** Edit modal — a plain toggle can't capture the required reason, so setting
 * Invoice Released to "No" always goes through this form instead. Setting it
 * to "Yes" is blocked server-side while any submission the CO is tied to
 * (its auto-add source, plus whatever's manually linked) isn't yet
 * Completed — `warning` surfaces that rejection inline instead of a toast
 * alone, since it names specific submissions the user needs to go check. */
function InvoiceReleasedModal({ co, onClose, onSave, saving, warning }) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (co) {
      setValue(co.invoice_released || "");
      setReason(co.invoice_released_reason || "");
    }
  }, [co]);

  const reasonRequired = value === "No";
  const canSubmit = !reasonRequired || reason.trim().length > 0;

  return (
    <Modal
      open={!!co}
      onClose={onClose}
      title={`Invoice Released — CO${co?.co_number ?? ""}`}
      maxWidth={480}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!canSubmit || saving}
            onClick={() => onSave(co.id, value, reason.trim())}
          >
            Save
          </button>
        </>
      }
    >
      {warning && (
        <div className="alert alert-warning d-flex gap-2 mb-3" role="alert">
          <i className="bi bi-exclamation-triangle-fill mt-1" />
          <div>
            <div className="fw-semibold">{warning.message}</div>
            {warning.incomplete?.length > 0 && (
              <ul className="mb-0 mt-1 ps-3 small">
                {warning.incomplete.map((s) => (
                  <li key={s.id}>
                    #{s.id}
                    {s.name ? ` — ${s.name}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <label className="form-label">Invoice Released</label>
      <div className="d-flex gap-3 mb-3">
        {[
          { key: "", label: "Not Set" },
          { key: "Yes", label: "Yes" },
          { key: "No", label: "No" },
        ].map((opt) => (
          <label key={opt.key || "unset"} className="form-check">
            <input
              type="radio"
              className="form-check-input me-1"
              checked={value === opt.key}
              onChange={() => setValue(opt.key)}
            />
            {opt.label}
          </label>
        ))}
      </div>

      {reasonRequired && (
        <>
          <label className="form-label">Reason Invoice Was Not Released</label>
          <textarea
            className="form-control"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Required — explain why the invoice hasn't been released"
          />
          {!canSubmit && <p className="text-danger small mt-1 mb-0">A reason is required when Invoice Released is No.</p>}
        </>
      )}
    </Modal>
  );
}
