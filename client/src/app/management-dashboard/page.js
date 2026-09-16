"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import StatPill from "../../components/StatPill";
import Modal from "../../components/Modal";
import SearchableDropdown from "../../components/SearchableDropdown";
import { useAuth } from "../../lib/AuthContext";
import { useManagementDashboardChangeOrders, useSetInvoiceReleased } from "../../hooks/useManagementDashboard";
import { ApiError } from "../../lib/api";
import { useToast } from "../../lib/ToastContext";

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
  const [projectFilter, setProjectFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState(null); // the CO row being edited

  const { data, isFetching } = useManagementDashboardChangeOrders({
    page,
    status: statusFilter === "all" ? undefined : statusFilter,
    project: projectFilter || undefined,
    search: search || undefined,
  });
  const setInvoiceReleased = useSetInvoiceReleased();

  const changeOrders = data?.change_orders || [];
  const projectOptions = data?.projects || [];
  const summary = data?.summary || { total: 0, released_yes: 0, released_no: 0, not_set: 0 };

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

  async function handleSave(id, invoiceReleased, reason) {
    try {
      await setInvoiceReleased.mutateAsync({ id, invoiceReleased, reason });
      setEditTarget(null);
      toast.success("Invoice Released updated.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to update Invoice Released.");
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

      <div className="table-responsive">
        <table className="table table-hover align-middle">
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              <th>CO #</th>
              <th>Date</th>
              <th>Change Type</th>
              <th>Hours</th>
              <th>Approval</th>
              <th>Billed</th>
              <th>Invoice Released</th>
              <th>Reason (if No)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {changeOrders.map((co) => (
              <tr key={co.id}>
                <td><a href={`/projects/${encodeURIComponent(co.project)}`}>{co.project}</a></td>
                <td>{co.client || "—"}</td>
                <td>CO#{co.co_number}</td>
                <td>{co.date || "—"}</td>
                <td>{co.change_type || "—"}</td>
                <td>{Number(co.hours ?? 0).toFixed(2)}</td>
                <td>
                  <span className={`co-status-pill co-status-${co.approval.toLowerCase()}`}>{co.approval}</span>
                </td>
                <td>{co.billed ? "Yes" : "No"}</td>
                <td>
                  <InvoiceReleasedBadge value={co.invoice_released} />
                </td>
                <td className="text-muted small">{co.invoice_released === "No" ? co.invoice_released_reason || "—" : "—"}</td>
                <td>
                  {canEdit && (
                    <button className="btn btn-sm btn-outline-primary" onClick={() => setEditTarget(co)}>
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

      <InvoiceReleasedModal co={editTarget} onClose={() => setEditTarget(null)} onSave={handleSave} saving={setInvoiceReleased.isPending} />
    </AppLayout>
  );
}

function InvoiceReleasedBadge({ value }) {
  if (value === "Yes") return <span className="badge bg-success">Yes</span>;
  if (value === "No") return <span className="badge bg-danger">No</span>;
  return <span className="badge bg-secondary">Not Set</span>;
}

/** Edit modal — a plain toggle can't capture the required reason, so setting
 * Invoice Released to "No" always goes through this form instead. */
function InvoiceReleasedModal({ co, onClose, onSave, saving }) {
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
      title={`Invoice Released — CO#${co?.co_number ?? ""}`}
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
