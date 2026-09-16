"use client";
import { useEffect, useState } from "react";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import SearchableDropdown from "../../components/SearchableDropdown";
import { api, ApiError } from "../../lib/api";
import { useToast } from "../../lib/ToastContext";

const SUBMISSION_TYPES = ["OFA", "FAB", "REAPPROVAL", "REVISION", "FOR REVIEW", "FIELD USE"];

export default function ReportsPage() {
  const toast = useToast();
  const [meta, setMeta] = useState({ projects: [], clients: [] });
  useEffect(() => {
    api.get("/projects").then(setMeta);
  }, []);

  const [form, setForm] = useState({
    group_by: "project", f_project: "", f_client: "", f_team: "", f_type: "", f_status: "", f_created_by: "",
    f_sub_from: "", f_sub_to: "", f_due_from: "", f_due_to: "",
  });
  const [busy, setBusy] = useState(false);

  async function handleExport(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.download("/reports/export", { method: "POST", body: form });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppLayout allow={["admin", "management"]}>
      <PageHero theme="navy" icon="bi-file-earmark-bar-graph-fill" title="Reports" meta="Ad-hoc filtered Excel export" />
      <div className="card-form" style={{ maxWidth: 640 }}>
        <form onSubmit={handleExport}>
          <label className="form-label">Group By</label>
          <div className="d-flex gap-3 mb-3">
            {["project", "client", "team"].map((g) => (
              <label key={g} className="form-check">
                <input type="radio" className="form-check-input me-1" checked={form.group_by === g} onChange={() => setForm((f) => ({ ...f, group_by: g }))} />
                {g}
              </label>
            ))}
          </div>

          <div className="row g-2">
            <div className="col-md-4">
              <label className="form-label">Project</label>
              <SearchableDropdown value={form.f_project} onChange={(v) => setForm((f) => ({ ...f, f_project: v }))} options={meta.projects} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Client</label>
              <SearchableDropdown value={form.f_client} onChange={(v) => setForm((f) => ({ ...f, f_client: v }))} options={meta.clients} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Team</label>
              <input className="form-control" value={form.f_team} onChange={(e) => setForm((f) => ({ ...f, f_team: e.target.value }))} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Type</label>
              <select className="form-select" value={form.f_type} onChange={(e) => setForm((f) => ({ ...f, f_type: e.target.value }))}>
                <option value="">Any</option>
                {SUBMISSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">Status</label>
              <select className="form-select" value={form.f_status} onChange={(e) => setForm((f) => ({ ...f, f_status: e.target.value }))}>
                <option value="">Any</option>
                <option value="ON TRACK">ON TRACK</option>
                <option value="DUE SOON">DUE SOON</option>
                <option value="OVERDUE">OVERDUE</option>
                <option value="COMPLETED">COMPLETED</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">Created By</label>
              <input className="form-control" value={form.f_created_by} onChange={(e) => setForm((f) => ({ ...f, f_created_by: e.target.value }))} />
            </div>
            <div className="col-md-3">
              <label className="form-label">Sub Date From</label>
              <input type="date" className="form-control" value={form.f_sub_from} onChange={(e) => setForm((f) => ({ ...f, f_sub_from: e.target.value }))} />
            </div>
            <div className="col-md-3">
              <label className="form-label">Sub Date To</label>
              <input type="date" className="form-control" value={form.f_sub_to} onChange={(e) => setForm((f) => ({ ...f, f_sub_to: e.target.value }))} />
            </div>
            <div className="col-md-3">
              <label className="form-label">Due Date From</label>
              <input type="date" className="form-control" value={form.f_due_from} onChange={(e) => setForm((f) => ({ ...f, f_due_from: e.target.value }))} />
            </div>
            <div className="col-md-3">
              <label className="form-label">Due Date To</label>
              <input type="date" className="form-control" value={form.f_due_to} onChange={(e) => setForm((f) => ({ ...f, f_due_to: e.target.value }))} />
            </div>
          </div>

          <button type="submit" className="btn btn-primary mt-3" disabled={busy}>
            <i className="bi bi-file-earmark-excel" /> {busy ? "Exporting…" : "Export to Excel"}
          </button>
          <p className="text-muted small mt-2">All filters are optional — leave blank to include everything. Export is org-wide (not limited to your selected teams).</p>
        </form>
      </div>
    </AppLayout>
  );
}
