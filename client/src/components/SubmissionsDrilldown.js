"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import StatusBadge from "./StatusBadge";
import HoldViewModal from "./HoldViewModal";
import HoldAttachmentModal from "./HoldAttachmentModal";
import RecordInfoModal from "./RecordInfoModal";
import SubmissionOverview from "./SubmissionOverview";
import PageHero from "./PageHero";
import StatPill from "./StatPill";
import PercentageCell from "./PercentageCell";
import SearchableDropdown from "./SearchableDropdown";
import SwitchToggle from "./SwitchToggle";
import Modal from "./Modal";
import { useDeleteRecord, useToggleField, useQaqcToggle, useUpdateRecord, useDashboardConfig } from "../hooks/useRecords";
import { useToast } from "../lib/ToastContext";

const SUBMISSION_TYPES = ["OFA", "FAB", "REAPPROVAL", "REVISION", "FOR REVIEW", "FIELD USE"];
const EMPTY_FORM = { project: "", submission_name: "", client: "", team: "", submission_type: "", sub_date: "", due_date: "", remarks: "", status_override: "", percentage: 0 };

/** Replaces both project_submissions.html and client_submissions.html — `by` selects which. */
export default function SubmissionsDrilldown({ by, name }) {
  const { user } = useAuth();
  const toast = useToast();
  // Who can Edit/Delete is the Settings page's per-user lists
  // (settingsService.canUpdateRecords/canDeleteRecords/canDeleteChangeOrders/
  // canDeleteRfis), not a shared password or a hardcoded role — QA Done and
  // Billable are just fields on the record, so they ride the same
  // canUpdateRecords-backed `canEdit` as the row's own Edit button. Invoice
  // Released keeps its own dedicated Settings list (canEditInvoiceReleased).
  const canDelete = !!user.can_delete_records;
  const canEdit = !!user.can_update_records;
  const canDeleteChangeOrders = !!user.can_delete_change_orders;
  const canDeleteRfis = !!user.can_delete_rfis;
  const canEditInvoiceReleased = !!user.can_edit_invoice_released;
  const endpoint = by === "project" ? "/records/by-project" : "/records/by-client";
  const paramKey = by === "project" ? "project" : "client";

  const { data, refetch } = useQuery({
    queryKey: [endpoint, name],
    queryFn: () => api.get(endpoint, { [paramKey]: name }),
  });
  const allRecords = data?.records || [];

  // The project's own completion signoff (Project Lifecycle widget's "Mark
  // Project Completed" button) — only meaningful on the project drilldown.
  const { data: projectData, refetch: refetchProject } = useQuery({
    queryKey: ["project-detail", name],
    queryFn: () => api.get(`/projects/${encodeURIComponent(name)}`),
    enabled: by === "project" && !!name,
  });

  async function handleMarkProjectCompleted() {
    try {
      const res = await api.post("/projects", { action: "mark_completed", project_name: name });
      toast.success(res.message || `Project '${name}' marked completed.`);
      refetchProject();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to mark project completed.");
    }
  }

  async function handleMarkOfaCompleted() {
    try {
      const res = await api.post("/projects", { action: "mark_ofa_completed", project_name: name });
      toast.success(res.message || `OFA marked completed for '${name}'.`);
      refetchProject();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to mark OFA completed.");
    }
  }

  async function handleMarkFabCompleted() {
    try {
      const res = await api.post("/projects", { action: "mark_fab_completed", project_name: name });
      toast.success(res.message || `Fabrication marked completed for '${name}'.`);
      refetchProject();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to mark Fabrication completed.");
    }
  }

  // ── Edit (admin/management only) ─────────────────────────
  const [meta, setMeta] = useState({ projects: [], clients: [] });
  useEffect(() => {
    if (canEdit) api.get("/projects").then((d) => setMeta(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);
  const { data: config } = useDashboardConfig({});

  const [editing, setEditing] = useState(null); // record being edited, or null
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const updateMutation = useUpdateRecord();
  const [pendingHold, setPendingHold] = useState(null); // { note, file } queued from the hold modal
  const [holdModal, setHoldModal] = useState({ open: false, mode: null, recordId: null, initial: null });

  function openEdit(r) {
    setEditing(r);
    // Must start locked to the record's current override (COMPLETED/ON HOLD),
    // matching the single option editStatusOptions offers for those cases
    // below — otherwise this stays "" (Auto) while the dropdown visually
    // shows "COMPLETED (locked)" (its only option), and submitting without
    // ever touching the field sends status_override="" to the server, which
    // recomputes the status live from the due date and silently un-completes
    // the record (e.g. just bumping its percentage).
    const upper = (r.status || "").toUpperCase();
    setEditForm({
      project: r.project,
      submission_name: r.submission_name,
      client: r.client,
      team: r.team,
      submission_type: r.submission_type,
      sub_date: r.sub_date_raw,
      due_date: r.due_date_raw,
      remarks: r.remarks,
      status_override: upper.startsWith("COMPLETED") ? "COMPLETED" : upper === "ON HOLD" ? "ON HOLD" : "",
      percentage: r.percentage ?? 0,
    });
    setPendingHold(null);
  }

  // Status-override option set depends on current status — same rule as the main dashboard's edit panel.
  const editStatusOptions = (() => {
    if (!editing) return [];
    const upper = (editing.status || "").toUpperCase();
    if (upper.startsWith("COMPLETED")) return [{ value: "COMPLETED", label: "COMPLETED (locked)" }];
    if (upper === "ON HOLD") {
      return [
        { value: "ON HOLD", label: "ON HOLD" },
        { value: "__RELEASE__", label: "Release Hold (recompute status)" },
        { value: "COMPLETED", label: "Mark COMPLETED" },
      ];
    }
    return [
      { value: "", label: `Auto (${editing.status})` },
      { value: "COMPLETED", label: "Mark COMPLETED" },
      { value: "ON HOLD", label: "Put ON HOLD" },
    ];
  })();

  function submitEditRequest(e) {
    e.preventDefault();
    if (editForm.status_override === "ON HOLD" && !pendingHold) {
      setHoldModal({ open: true, mode: "edit", recordId: editing.id, initial: { text: editing.hold_text, image_filename: editing.hold_image } });
      return;
    }
    confirmUpdate();
  }

  async function confirmUpdate() {
    const fd = new FormData();
    Object.entries(editForm).forEach(([k, v]) => fd.append(k, v ?? ""));
    if (pendingHold?.note) fd.append("onhold_note", pendingHold.note);
    if (pendingHold?.file) fd.append("onhold_file", pendingHold.file);
    try {
      const res = await updateMutation.mutateAsync({ id: editing.id, formData: fd });
      toast.success(res.message);
      setEditing(null);
      setPendingHold(null);
      refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update record.");
    }
  }

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sideFilter, setSideFilter] = useState(""); // client filter (on project page) or project filter (on client page)
  const [sort, setSort] = useState({ col: "", dir: "asc" });

  const otherKey = by === "project" ? "client" : "project";
  const otherValues = [...new Set(allRecords.map((r) => r[otherKey]))].sort();
  const types = [...new Set(allRecords.map((r) => r.submission_type))].sort();

  let records = allRecords.filter((r) => {
    if (search) {
      const s = search.toLowerCase();
      if (!`${r.project} ${r.submission_name} ${r.client} ${r.status} ${r.remarks}`.toLowerCase().includes(s)) return false;
    }
    if (statusFilter && !r.status.toUpperCase().startsWith(statusFilter)) return false;
    if (typeFilter && r.submission_type !== typeFilter) return false;
    if (sideFilter && r[otherKey] !== sideFilter) return false;
    return true;
  });
  if (sort.col) {
    records = [...records].sort((a, b) => {
      const av = String(a[sort.col] ?? "").toLowerCase();
      const bv = String(b[sort.col] ?? "").toLowerCase();
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    if (sort.dir === "desc") records.reverse();
  }

  const stats = {
    total: allRecords.length,
    overdue: allRecords.filter((r) => r.tag === "overdue").length,
    duesoon: allRecords.filter((r) => r.tag === "duesoon").length,
    ontrack: allRecords.filter((r) => r.tag === "ontrack").length,
    completed: allRecords.filter((r) => r.tag.startsWith("completed")).length,
    hold: allRecords.filter((r) => r.tag === "hold").length,
  };

  const toggleField = useToggleField();
  const toggleQaqc = useQaqcToggle();
  const deleteMutation = useDeleteRecord();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [holdView, setHoldView] = useState(null);
  const [infoView, setInfoView] = useState(null);

  async function confirmDelete() {
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id });
      setDeleteTarget(null);
      refetch();
      toast.success("Record deleted.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to delete.");
    }
  }

  function toggleSort(col) {
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }));
  }

  const heroTheme = by === "project" ? "navyblue" : "emerald";
  const tableTheme = by === "project" ? "theme-navyblue" : "theme-emerald";

  return (
    <div>
      <PageHero
        theme={heroTheme}
        icon={by === "project" ? "bi-folder-fill" : "bi-building"}
        title={`${by === "project" ? "Project" : "Client"}: ${name}`}
        meta={`${stats.total} submissions`}
      />

      {by === "project" && allRecords.length > 0 && (
        <SubmissionOverview
          records={allRecords}
          canEdit={canEdit}
          canDelete={canDelete}
          canDeleteChangeOrders={canDeleteChangeOrders}
          canDeleteRfis={canDeleteRfis}
          projectCompleted={!!projectData?.completed}
          projectCompletedAt={projectData?.completed_at}
          onMarkProjectCompleted={handleMarkProjectCompleted}
          ofaCompleted={!!projectData?.ofa_completed}
          ofaCompletedAt={projectData?.ofa_completed_at}
          onMarkOfaCompleted={handleMarkOfaCompleted}
          fabCompleted={!!projectData?.fab_completed}
          fabCompletedAt={projectData?.fab_completed_at}
          onMarkFabCompleted={handleMarkFabCompleted}
          onEditRecord={openEdit}
          onDeleteRecord={setDeleteTarget}
        />
      )}

      <div className="stats-bar">
        <StatPill num={stats.total} label="Total" />
        <StatPill num={stats.overdue} label="Overdue" color="#e74c3c" />
        <StatPill num={stats.duesoon} label="Due Soon" color="#e67e22" />
        <StatPill num={stats.ontrack} label="On Track" color="#27ae60" />
        <StatPill num={stats.completed} label="Completed" color="#3498db" />
        <StatPill num={stats.hold} label="On Hold" color="#7c3aed" />
      </div>

      {by !== "project" && (
        <>
          <div className="filter-bar d-flex flex-wrap gap-2">
            <input className="form-control" style={{ maxWidth: 220 }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="form-select" style={{ maxWidth: 180 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="ON TRACK">On Track</option>
              <option value="DUE SOON">Due Soon</option>
              <option value="DUE TODAY">Due Today</option>
              <option value="OVERDUE">Overdue</option>
              <option value="COMPLETED">Completed</option>
              <option value="ON HOLD">On Hold</option>
            </select>
            <select className="form-select" style={{ maxWidth: 180 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="form-select" style={{ maxWidth: 200 }} value={sideFilter} onChange={(e) => setSideFilter(e.target.value)}>
              <option value="">All {otherKey}s</option>
              {otherValues.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div className={`table-wrap ${tableTheme}`}>
            <table className="table table-sm mb-0">
              <thead>
                <tr>
                  <th>#</th>
                  <th className={`sortable${sort.col === "submission_name" ? ` sort-${sort.dir}` : ""}`} onClick={() => toggleSort("submission_name")}>Submission</th>
                  <th className={`sortable${sort.col === otherKey ? ` sort-${sort.dir}` : ""}`} onClick={() => toggleSort(otherKey)}>{otherKey === "client" ? "Client" : "Project"}</th>
                  <th className={`sortable${sort.col === "submission_type" ? ` sort-${sort.dir}` : ""}`} onClick={() => toggleSort("submission_type")}>Type</th>
                  <th className={`sortable${sort.col === "team" ? ` sort-${sort.dir}` : ""}`} onClick={() => toggleSort("team")}>Team</th>
                  <th className={`sortable${sort.col === "sub_date_raw" ? ` sort-${sort.dir}` : ""}`} onClick={() => toggleSort("sub_date_raw")}>Sub Date</th>
                  <th className={`sortable${sort.col === "due_date_raw" ? ` sort-${sort.dir}` : ""}`} onClick={() => toggleSort("due_date_raw")}>Due Date</th>
                  <th>Remarks</th>
                  <th className={`sortable${sort.col === "status" ? ` sort-${sort.dir}` : ""}`} onClick={() => toggleSort("status")}>Status</th>
                  <th>Percentage</th>
                  <th>Type of Submission</th>
                  <th>QA</th>
                  <th>Billable</th>
                  <th>Invoice Released</th>
                  <th>Created By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={r.id} className={r.tag}>
                    <td>{i + 1}</td>
                    <td>
                      <a href={`/projects/${encodeURIComponent(r.project)}`}>{r.submission_name}</a>
                    </td>
                    <td>
                      <a className={otherKey === "client" ? "client-link" : "proj-link"} href={`/${otherKey === "client" ? "clients" : "projects"}/${encodeURIComponent(r[otherKey])}`}>{r[otherKey]}</a>
                    </td>
                    <td>{r.submission_type}</td>
                    <td>{r.team}</td>
                    <td>{r.sub_date}</td>
                    <td>{r.due_date}</td>
                    <td>
                      {r.tag === "hold" && (r.hold_text || r.hold_image) ? (
                        <a href="#" onClick={(e) => { e.preventDefault(); setHoldView(r); }}>📎 {r.remarks || "note"}</a>
                      ) : r.remarks}
                    </td>
                    <td><StatusBadge status={r.status} tag={r.tag} /></td>
                    <td>
                      <PercentageCell value={r.percentage} />
                    </td>
                    <td>{r.steel_type || "N/A"}</td>
                    <td>
                      <SwitchToggle
                        label="QA Done"
                        value={r.qaqc}
                        disabled={!canEdit}
                        onChange={(v) => toggleQaqc.mutate({ id: r.id, value: v }, { onSuccess: refetch })}
                      />
                    </td>
                    <td>
                      <SwitchToggle
                        label="Billable"
                        value={r.billable}
                        disabled={!canEdit}
                        onChange={(v) => toggleField.mutate({ id: r.id, field: "billable", value: v }, { onSuccess: refetch })}
                      />
                    </td>
                    <td>
                      <SwitchToggle
                        label="Invoice Released"
                        value={r.invoice_released}
                        disabled={!canEditInvoiceReleased}
                        onChange={(v) => toggleField.mutate({ id: r.id, field: "invoice_released", value: v }, { onSuccess: refetch })}
                      />
                    </td>
                    <td>{r.created_by}</td>
                    <td>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => setInfoView(r)}><i className="bi bi-info-circle" /></button>
                      {canEdit && (
                        <button className="btn btn-sm btn-outline-primary ms-1" onClick={() => openEdit(r)}><i className="bi bi-pencil" /></button>
                      )}
                      {canDelete && (
                        <button className="btn btn-sm btn-outline-danger ms-1" onClick={() => setDeleteTarget(r)}><i className="bi bi-trash" /></button>
                      )}
                    </td>
                  </tr>
                ))}
                {!records.length && (
                  <tr><td colSpan={16} className="text-center text-muted py-4">No records found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <HoldViewModal open={!!holdView} onClose={() => setHoldView(null)} record={holdView} />
      <RecordInfoModal open={!!infoView} onClose={() => setInfoView(null)} record={infoView} />

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit Record #${editing?.id ?? ""}`} maxWidth={820}>
        {editing && (
          <form onSubmit={submitEditRequest} className="row g-2">
            <div className="col-md-3">
              <label className="form-label small mb-1">Project <span className="text-danger">*</span></label>
              <SearchableDropdown value={editForm.project} onChange={(v) => setEditForm((f) => ({ ...f, project: v }))} options={meta.projects} required />
            </div>
            <div className="col-md-3">
              <label className="form-label small mb-1">Submission Name <span className="text-danger">*</span></label>
              <input className="form-control" required value={editForm.submission_name} onChange={(e) => setEditForm((f) => ({ ...f, submission_name: e.target.value }))} />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Client <span className="text-danger">*</span></label>
              <SearchableDropdown value={editForm.client} onChange={(v) => setEditForm((f) => ({ ...f, client: v }))} options={meta.clients} required />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Team <span className="text-danger">*</span></label>
              <SearchableDropdown value={editForm.team} onChange={(v) => setEditForm((f) => ({ ...f, team: v }))} options={config?.selectableTeams || []} required />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Type <span className="text-danger">*</span></label>
              <select className="form-select" required value={editForm.submission_type} onChange={(e) => setEditForm((f) => ({ ...f, submission_type: e.target.value }))}>
                {SUBMISSION_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Submission Date</label>
              <input type="date" className="form-control" value={editForm.sub_date} onChange={(e) => setEditForm((f) => ({ ...f, sub_date: e.target.value, due_date: e.target.value }))} />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Due Date</label>
              <input type="date" className="form-control" value={editForm.due_date} onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Status</label>
              <select className="form-select" value={editForm.status_override} onChange={(e) => setEditForm((f) => ({ ...f, status_override: e.target.value }))}>
                {editStatusOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label small mb-1">Remarks</label>
              <input className="form-control" placeholder="Remarks" value={editForm.remarks} onChange={(e) => setEditForm((f) => ({ ...f, remarks: e.target.value }))} />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Percentage %</label>
              <input
                type="number"
                min={0}
                max={100}
                className="form-control"
                placeholder="Percentage %"
                value={editForm.percentage}
                onChange={(e) => setEditForm((f) => ({ ...f, percentage: e.target.value }))}
              />
            </div>
            <div className="col-12 d-flex justify-content-end gap-2 mt-2">
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        )}
      </Modal>

      <HoldAttachmentModal
        open={holdModal.open}
        onClose={() => setHoldModal({ open: false, mode: null, recordId: null, initial: null })}
        mode={holdModal.mode}
        recordId={holdModal.recordId}
        initial={holdModal.initial}
        onAttach={(note, file) => setPendingHold({ note, file })}
        onSaved={refetch}
      />

      {deleteTarget && (
        <div className="st-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDeleteTarget(null)}>
          <div className="st-modal" style={{ maxWidth: 420 }}>
            <div className="st-modal-header header-danger"><h5 className="m-0">Delete Record</h5></div>
            <div className="st-modal-body">
              <p className="mb-0">Delete record #{deleteTarget.id}? This cannot be undone.</p>
            </div>
            <div className="st-modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDelete} disabled={deleteMutation.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
