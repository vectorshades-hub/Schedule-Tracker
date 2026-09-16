"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import StatPill from "../../components/StatPill";
import PercentageCell from "../../components/PercentageCell";
import SwitchToggle from "../../components/SwitchToggle";
import Modal from "../../components/Modal";
import { useAuth } from "../../lib/AuthContext";
import { useToast } from "../../lib/ToastContext";
import { api, ApiError, API_URL } from "../../lib/api";

const TYPE_PILL_CLASS = {
  FAB: "type-pill-fab",
  OFA: "type-pill-ofa",
  REAPPROVAL: "type-pill-reapproval",
  REVISION: "type-pill-revision",
  "FOR REVIEW": "type-pill-review",
  "FIELD USE": "type-pill-field",
};
const SUBMISSION_TYPES = ["OFA", "FAB", "REAPPROVAL", "REVISION", "FOR REVIEW", "FIELD USE"];
const STEEL_TYPES = ["Main Steel", "Misc Steel", "Main & Misc Steel"];

function TypePill({ type }) {
  return <span className={`type-pill ${TYPE_PILL_CLASS[type] || "type-pill-default"}`}>{type}</span>;
}

/** Edit an archived entry's details — gated by canEditCompletedLog (Settings page).
 * `form`/`setForm` live in the parent (seeded by openEdit()) rather than here, matching
 * RecordsDashboard's edit-panel pattern — keeps this a plain controlled form with no
 * prop-to-state sync of its own. */
function EditModal({ entry, form, setForm, onClose, onSave, saving }) {
  if (!entry || !form) return null;

  function submit(e) {
    e.preventDefault();
    onSave(entry.id, form);
  }

  return (
    <Modal open={!!entry} onClose={onClose} title={`Edit Submission #${entry.record_id}`} maxWidth={820}>
      <form onSubmit={submit} className="row g-2">
        <div className="col-md-4">
          <label className="form-label small mb-1">Project <span className="text-danger">*</span></label>
          <input className="form-control" required value={form.project} onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))} />
        </div>
        <div className="col-md-4">
          <label className="form-label small mb-1">Submission Name <span className="text-danger">*</span></label>
          <input className="form-control" required value={form.submission_name} onChange={(e) => setForm((f) => ({ ...f, submission_name: e.target.value }))} />
        </div>
        <div className="col-md-4">
          <label className="form-label small mb-1">Client <span className="text-danger">*</span></label>
          <input className="form-control" required value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))} />
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-1">Type <span className="text-danger">*</span></label>
          <select className="form-select" required value={form.submission_type} onChange={(e) => setForm((f) => ({ ...f, submission_type: e.target.value }))}>
            {SUBMISSION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-1">Type of Submission</label>
          <select className="form-select" value={form.steel_type} onChange={(e) => setForm((f) => ({ ...f, steel_type: e.target.value }))}>
            <option value="">Type of Submission…</option>
            {STEEL_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-1">Team <span className="text-danger">*</span></label>
          <input className="form-control" required value={form.team} onChange={(e) => setForm((f) => ({ ...f, team: e.target.value }))} />
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-1">Percentage %</label>
          <input
            type="number"
            min={0}
            max={100}
            className="form-control"
            value={form.percentage}
            onChange={(e) => setForm((f) => ({ ...f, percentage: e.target.value }))}
          />
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-1">Sub Date</label>
          <input type="date" className="form-control" value={form.sub_date} onChange={(e) => setForm((f) => ({ ...f, sub_date: e.target.value }))} />
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-1">Due Date</label>
          <input type="date" className="form-control" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
        </div>
        <div className="col-md-6">
          <label className="form-label small mb-1">Remarks</label>
          <input className="form-control" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
        </div>
        <div className="col-12 d-flex justify-content-end gap-2 mt-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

/** Archived At / ID / Created By / Archived By moved here from their own
 * columns to keep the table from getting too wide — `showCreator` hides
 * Created By/Archived By for team leads, same gating those columns had. */
function InfoModal({ entry, onClose, showCreator }) {
  if (!entry) return null;
  return (
    <Modal open={!!entry} onClose={onClose} title={`Submission #${entry.record_id}`}>
      <dl className="row mb-0">
        <dt className="col-5">Archived At</dt>
        <dd className="col-7">{entry.archived_at || "—"}</dd>
        {showCreator && (
          <>
            <dt className="col-5">Created By</dt>
            <dd className="col-7">{entry.created_by || "—"}</dd>
            <dt className="col-5">Archived By</dt>
            <dd className="col-7">
              {["auto-delete", "auto-archive"].includes(entry.archived_by) ? "Auto" : entry.archived_by || "—"}
            </dd>
          </>
        )}
      </dl>
    </Modal>
  );
}

export default function CompletedLogPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["completed-log"], queryFn: () => api.get("/completed-log"), enabled: !!user });
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [archiverFilter, setArchiverFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  // Billable/Invoice Released here mirror POST /api/completed-log/:id/toggle-field:
  // billable needs the "who can edit completed log" list (that list already covers
  // every other field on this page, and grants admins access on its own — no separate
  // role check needed), invoice_released needs the Settings page's invoice-released
  // editors list.
  const [pendingToggle, setPendingToggle] = useState(null); // { label, next, run } or null
  const [infoView, setInfoView] = useState(null); // the entry shown in the info popup, or null
  const toggleField = useMutation({
    mutationFn: ({ id, field, value }) => api.post(`/completed-log/${id}/toggle-field`, { field, value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["completed-log"] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Failed to update."),
  });
  function requestToggleConfirm(label, next, run) {
    setPendingToggle({ label, next, run });
  }

  // ── Edit entry — gated by Settings page's canEditCompletedLog list ────
  const [editing, setEditing] = useState(null); // the entry being edited, or null
  const [editForm, setEditForm] = useState(null);
  const updateEntry = useMutation({
    mutationFn: ({ id, payload }) => api.put(`/completed-log/${id}`, payload),
    onSuccess: (res) => {
      toast.success(res.message || "Completed Log entry updated.");
      qc.invalidateQueries({ queryKey: ["completed-log"] });
      setEditing(null);
      setEditForm(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Failed to update."),
  });
  function openEdit(e) {
    setEditing(e);
    setEditForm({
      project: e.project || "",
      submission_name: e.submission_name || "",
      client: e.client || "",
      submission_type: e.submission_type || "",
      steel_type: e.steel_type || "",
      team: e.team || "",
      sub_date: e.sub_date || "",
      due_date: e.due_date || "",
      remarks: e.remarks || "",
      percentage: e.percentage ?? 0,
    });
  }
  function closeEdit() {
    setEditing(null);
    setEditForm(null);
  }

  // Guard placed after every hook call above (Rules of Hooks) — this page reads `user`
  // directly rather than via a child of <AppLayout>, so it renders before AppLayout's own
  // auth gate does; bail out here while auth is still loading (also makes the page SSG-safe).
  if (!user) return null;

  const entries = data?.entries || [];
  const isTeamLead = user.role === "team_lead";
  const canEditCompletedLog = !!user.can_edit_completed_log;
  const canEditInvoiceReleased = !!user.can_edit_invoice_released;

  const filtered = entries.filter((e) => {
    if (search) {
      const s = search.toLowerCase();
      if (!`${e.project} ${e.submission_name} ${e.client} ${e.team}`.toLowerCase().includes(s)) return false;
    }
    if (teamFilter && e.team !== teamFilter) return false;
    if (archiverFilter) {
      if (archiverFilter === "__auto__" && !["auto-delete", "auto-archive"].includes(e.archived_by)) return false;
      if (archiverFilter !== "__auto__" && e.archived_by !== archiverFilter) return false;
    }
    if (typeFilter && e.submission_type !== typeFilter) return false;
    return true;
  });

  return (
    <AppLayout allow={["admin", "management", "team_lead"]}>
      <PageHero
        theme="emerald"
        icon="bi-check2-circle"
        title="Completed Projects Log"
        meta={`${data?.total ?? 0} archived`}
        right={
          <a className="export-btn" href={`${API_URL}/completed-log/export`} target="_blank" rel="noreferrer">
            <i className="bi bi-download" /> Export to Excel
          </a>
        }
      />

      <div className="stats-bar">
        <StatPill num={data?.total ?? 0} label="Total" />
        <StatPill num={data?.marked_by_user_count ?? 0} label="Marked by user" color="#1a6e4a" />
        {!isTeamLead && <StatPill num={data?.auto_count ?? 0} label="Auto-archived" color="#7c3aed" />}
      </div>

      <div className="filter-bar d-flex flex-wrap gap-2">
        <input className="form-control" style={{ maxWidth: 220 }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!isTeamLead && (
          <>
            <select className="form-select" style={{ maxWidth: 180 }} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="">All teams</option>
              {(data?.filters?.teams || []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="form-select" style={{ maxWidth: 200 }} value={archiverFilter} onChange={(e) => setArchiverFilter(e.target.value)}>
              <option value="">All archivers</option>
              <option value="__auto__">Auto-Archived</option>
              {(data?.filters?.archivers || []).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </>
        )}
        <select className="form-select" style={{ maxWidth: 180 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {(data?.filters?.types || []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="table-wrap theme-emerald">
        <table className="table table-sm table-hover align-middle mb-0 completed-log-table">
          <thead>
            <tr>
              <th>Project</th><th>Submission</th><th>Client</th><th>Type</th><th>Team</th>
              <th>Sub Date</th><th>Due Date</th><th>Completed At</th><th>QA Done</th><th>Type of Submission</th><th>Percentage</th>
              <th>Billable</th><th>Invoice Released</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className="cl-primary">{e.project}</td>
                <td>{e.submission_name}</td>
                <td>{e.client}</td>
                <td><TypePill type={e.submission_type} /></td>
                <td>{e.team}</td>
                <td className="cl-muted">{e.sub_date}</td>
                <td className="cl-muted">{e.due_date}</td>
                <td className="cl-muted">{e.completed_at}</td>
                <td>
                  {e.qaqc ? <span className={e.qaqc === "Yes" ? "qp-yes-badge" : "qp-no-badge"}>{e.qaqc}</span> : "—"}
                </td>
                <td>{e.steel_type || "N/A"}</td>
                <td><PercentageCell value={e.percentage} /></td>
                <td>
                  <SwitchToggle
                    label="Billable"
                    value={e.billable}
                    disabled={!canEditCompletedLog}
                    requestConfirm={requestToggleConfirm}
                    onChange={(v) => toggleField.mutate({ id: e.id, field: "billable", value: v })}
                  />
                </td>
                <td>
                  <SwitchToggle
                    label="Invoice Released"
                    value={e.invoice_released}
                    disabled={!canEditInvoiceReleased}
                    requestConfirm={requestToggleConfirm}
                    onChange={(v) => toggleField.mutate({ id: e.id, field: "invoice_released", value: v })}
                  />
                </td>
                <td className="text-nowrap">
                  <button type="button" className="btn btn-sm btn-outline-secondary" title="Info" onClick={() => setInfoView(e)}>
                    <i className="bi bi-info-circle" />
                  </button>
                  {canEditCompletedLog && (
                    <button type="button" className="btn btn-sm btn-outline-primary ms-1" title="Edit" onClick={() => openEdit(e)}>
                      <i className="bi bi-pencil" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={14} className="text-center text-muted py-5">
                  <i className="bi bi-inbox" style={{ fontSize: "1.4rem", display: "block", marginBottom: 6 }} />
                  No entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <InfoModal entry={infoView} onClose={() => setInfoView(null)} showCreator={!isTeamLead} />

      <EditModal
        entry={editing}
        form={editForm}
        setForm={setEditForm}
        onClose={closeEdit}
        onSave={(id, payload) => updateEntry.mutate({ id, payload })}
        saving={updateEntry.isPending}
      />

      <Modal
        open={!!pendingToggle}
        onClose={() => setPendingToggle(null)}
        title="Confirm Change"
        maxWidth={380}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setPendingToggle(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                pendingToggle?.run();
                setPendingToggle(null);
              }}
            >
              Confirm
            </button>
          </>
        }
      >
        <p className="mb-0">
          Set <strong>{pendingToggle?.label}</strong> to <strong>{pendingToggle?.next || "—"}</strong>?
        </p>
      </Modal>
    </AppLayout>
  );
}
