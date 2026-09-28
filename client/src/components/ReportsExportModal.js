"use client";
import { useEffect, useState } from "react";
import Modal from "./Modal";
import SearchableDropdown from "./SearchableDropdown";
import { api, ApiError } from "../lib/api";
import { useToast } from "../lib/ToastContext";

const SUBMISSION_TYPES = ["OFA", "FAB", "REAPPROVAL", "REVISION", "FOR REVIEW", "FIELD USE"];

const EMPTY_FORM = {
  group_by: "project", f_project: "", f_client: "", f_team: "", f_type: "", f_status: "", f_created_by: "",
  f_billable: "", f_invoice_released: "", f_sub_from: "", f_sub_to: "", f_due_from: "", f_due_to: "",
};

/** Ad-hoc filtered Excel export — org-wide, admin/management only. Opened from the navbar's "Reports" link. */
export default function ReportsExportModal({ open, onClose }) {
  const toast = useToast();
  const [meta, setMeta] = useState({ projects: [], clients: [], teams: [] });
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) api.get("/projects").then(setMeta);
  }, [open]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleExport(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.download("/reports/export", { method: "POST", body: form });
      onClose?.();
      setForm(EMPTY_FORM);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<><i className="bi bi-file-earmark-bar-graph-fill" /> Export Report</>}
      maxWidth={720}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="reports-export-form" className="btn btn-primary" disabled={busy}>
            <i className="bi bi-file-earmark-excel" /> {busy ? "Exporting…" : "Export Report"}
          </button>
        </>
      }
    >
      <form id="reports-export-form" onSubmit={handleExport}>
        <label className="form-label">Group / Sort by</label>
        <div className="d-flex gap-3 mb-3">
          {["project", "client", "team"].map((g) => (
            <label key={g} className="form-check">
              <input type="radio" className="form-check-input me-1" checked={form.group_by === g} onChange={() => set("group_by", g)} />
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </label>
          ))}
        </div>

        <label className="form-label small text-muted">Filters (all optional — leave blank for all records)</label>
        <div className="row g-2">
          <div className="col-md-4">
            <label className="form-label">Project Name</label>
            <SearchableDropdown value={form.f_project} onChange={(v) => set("f_project", v)} options={meta.projects} placeholder="Search or select…" />
          </div>
          <div className="col-md-4">
            <label className="form-label">Client Name</label>
            <SearchableDropdown value={form.f_client} onChange={(v) => set("f_client", v)} options={meta.clients} placeholder="Search or select…" />
          </div>
          <div className="col-md-4">
            <label className="form-label">Team</label>
            <SearchableDropdown value={form.f_team} onChange={(v) => set("f_team", v)} options={meta.teams} placeholder="Search or select…" />
          </div>

          <div className="col-md-4">
            <label className="form-label">Submission Type</label>
            <select className="form-select" value={form.f_type} onChange={(e) => set("f_type", e.target.value)}>
              <option value="">All Types</option>
              {SUBMISSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.f_status} onChange={(e) => set("f_status", e.target.value)}>
              <option value="">All Statuses</option>
              <option value="ON TRACK">ON TRACK</option>
              <option value="DUE SOON">DUE SOON</option>
              <option value="OVERDUE">OVERDUE</option>
              <option value="COMPLETED">COMPLETED</option>
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label">Created By</label>
            <SearchableDropdown value={form.f_created_by} onChange={(v) => set("f_created_by", v)} options={meta.teams} placeholder="Search or select…" />
          </div>

          <div className="col-md-4">
            <label className="form-label">Billable</label>
            <select className="form-select" value={form.f_billable} onChange={(e) => set("f_billable", e.target.value)}>
              <option value="">All</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label">Invoice Released</label>
            <select className="form-select" value={form.f_invoice_released} onChange={(e) => set("f_invoice_released", e.target.value)}>
              <option value="">All</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </div>

          <div className="col-md-3">
            <label className="form-label">Sub Date — From</label>
            <input type="date" className="form-control" value={form.f_sub_from} onChange={(e) => set("f_sub_from", e.target.value)} />
          </div>
          <div className="col-md-3">
            <label className="form-label">Sub Date — To</label>
            <input type="date" className="form-control" value={form.f_sub_to} onChange={(e) => set("f_sub_to", e.target.value)} />
          </div>
          <div className="col-md-3">
            <label className="form-label">Due Date — From</label>
            <input type="date" className="form-control" value={form.f_due_from} onChange={(e) => set("f_due_from", e.target.value)} />
          </div>
          <div className="col-md-3">
            <label className="form-label">Due Date — To</label>
            <input type="date" className="form-control" value={form.f_due_to} onChange={(e) => set("f_due_to", e.target.value)} />
          </div>
        </div>

        <p className="text-muted small mt-3 mb-0">
          <i className="bi bi-info-circle" /> Exports as .xlsx — opens in Excel. Export is org-wide (not limited to your selected teams).
        </p>
      </form>
    </Modal>
  );
}
