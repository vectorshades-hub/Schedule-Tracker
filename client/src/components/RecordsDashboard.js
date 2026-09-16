"use client";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { api, ApiError } from "../lib/api";
import {
  useRecordsQuery,
  useDashboardConfig,
  useAddRecord,
  useUpdateRecord,
  useDeleteRecord,
  useToggleField,
  useQaqcToggle,
} from "../hooks/useRecords";
import SearchableDropdown from "./SearchableDropdown";
import PercentageCell from "./PercentageCell";
import SwitchToggle from "./SwitchToggle";
import StatusBadge from "./StatusBadge";
import Modal from "./Modal";
import HoldAttachmentModal from "./HoldAttachmentModal";
import HoldViewModal from "./HoldViewModal";
import RecordInfoModal from "./RecordInfoModal";
import DailyPopup from "./DailyPopup";
import BirthdayPopup from "./BirthdayPopup";
import { useToast } from "../lib/ToastContext";

const SUBMISSION_TYPES = ["OFA", "FAB", "REAPPROVAL", "REVISION", "FOR REVIEW", "FIELD USE"];
const STEEL_TYPES = ["Main Steel", "Misc Steel", "Main & Misc Steel"];
// Billable/Invoice Released are intentionally not part of the Add form — a new
// record always starts as "No" for both (server-side default); they're only
// ever set afterward from the Edit form, which builds its own explicit object
// (see openEdit()) rather than spreading this base, so leaving them out here
// only affects the Add flow.
const EMPTY_FORM = { project: "", submission_name: "", client: "", team: "", submission_type: "", steel_type: "", sub_date: "", due_date: "", remarks: "", status_override: "", percentage: 0, billable: "No", invoice_released: "" };

/** yyyy-MM-dd in local time, matching what <input type="date"> expects. */
function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The single records dashboard, shared by every role — it used to be duplicated
 * across `/` (admin) and `/management` (management/team_lead/qaqc/user), driven
 * by a `variant` prop that just mirrored the route. The two were ~95% identical
 * (team-pill client toggle vs server-driven checkboxes + a `badgeTeam` display
 * flag being the only real differences, and the backend already branches purely
 * on session role regardless of which route called it), so both pages — and the
 * prop — were merged into this one component keyed entirely off `user.role`.
 */
export default function RecordsDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const canEdit = ["admin", "management", "team_lead"].includes(user.role);
  // Who can Edit/Delete a record is now the Settings page's per-user lists
  // (settingsService.canUpdateRecords/canDeleteRecords) instead of a shared
  // password — admins are always included server-side regardless of the list.
  const canEditRecords = !!user.can_update_records;
  const canDeleteRecords = !!user.can_delete_records;
  const canQaqc = ["admin", "qaqc"].includes(user.role);
  const canEditPercentage = ["admin", "management"].includes(user.role);
  const canEditBillable = ["admin", "management", "team_lead"].includes(user.role);
  const canEditInvoiceReleased = !!user.can_edit_invoice_released;
  const badgeTeam = user.role !== "admin";

  const [meta, setMeta] = useState({ projects: [], clients: [] });
  const reloadMasterLists = () => api.get("/projects").then((d) => setMeta(d));
  useEffect(() => {
    reloadMasterLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Project → its client, from the Manage Projects & Clients page's
  // relationship (server/src/routes/projects.js's `projectDetails`) — lets
  // picking a project on the Add/Edit forms below auto-fill Client instead
  // of making the user pick it twice.
  const projectClientMap = useMemo(() => {
    const map = {};
    for (const p of meta.projectDetails || []) {
      if (p.client) map[p.name] = p.client;
    }
    return map;
  }, [meta.projectDetails]);

  const { data: config } = useDashboardConfig({});
  const [selectedTeams, setSelectedTeams] = useState(null);
  useEffect(() => {
    if (config && selectedTeams === null) setSelectedTeams(config.selectedTeams || []);
  }, [config, selectedTeams]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ col: "", dir: "asc" });
  const [dates, setDates] = useState([]);
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const [customRangeDraft, setCustomRangeDraft] = useState({ from: "", to: "" });

  const queryParams = {
    page,
    search,
    teams: (selectedTeams || []).join(","),
    sort: sort.col,
    dir: sort.dir,
    dates: dates.join(","),
    date_from: customRange.from,
    date_to: customRange.to,
    badge_team: badgeTeam ? "1" : "0",
  };
  const { data, isFetching, refetch: refetchRecords } = useRecordsQuery(selectedTeams === null ? null : queryParams);
  const records = data?.records || [];

  // ── Add form ──────────────────────────────────────────
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM, sub_date: todayISO(), due_date: todayISO(), team: user.role !== "admin" ? user.username : "" });
  const addMutation = useAddRecord();
  const [pendingHold, setPendingHold] = useState(null); // { mode: 'add'|'edit', note, file } queued from the hold modal
  const [holdModal, setHoldModal] = useState({ open: false, mode: null, recordId: null, initial: null });

  async function submitAdd(e) {
    e.preventDefault();
    if (addForm.status_override === "ON HOLD" && !pendingHold) {
      setHoldModal({ open: true, mode: "add", recordId: null, initial: null });
      return;
    }
    const fd = new FormData();
    Object.entries(addForm).forEach(([k, v]) => fd.append(k, v ?? ""));
    if (pendingHold?.note) fd.append("onhold_note", pendingHold.note);
    if (pendingHold?.file) fd.append("onhold_file", pendingHold.file);
    try {
      const res = await addMutation.mutateAsync(fd);
      toast.success(res.message);
      setAddForm({ ...EMPTY_FORM, sub_date: todayISO(), due_date: todayISO(), team: addForm.team });
      setPendingHold(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add record.");
    }
  }

  // ── Edit panel ────────────────────────────────────────
  const [editing, setEditing] = useState(null); // record being edited, or null
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const updateMutation = useUpdateRecord();

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
      steel_type: r.steel_type,
      sub_date: r.sub_date_raw,
      due_date: r.due_date_raw,
      remarks: r.remarks,
      status_override: upper.startsWith("COMPLETED") ? "COMPLETED" : upper === "ON HOLD" ? "ON HOLD" : "",
      percentage: r.percentage ?? 0,
      billable: r.billable || "",
      invoice_released: r.invoice_released || "",
    });
    setPendingHold(null);
  }

  // Status-override option set depends on current status — ported from index.html's openEdit() JS.
  const editStatusOptions = useMemo(() => {
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
  }, [editing]);

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
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update record.");
    }
  }

  // ── Delete ────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState(null);
  const deleteMutation = useDeleteRecord();
  async function confirmDelete() {
    try {
      const res = await deleteMutation.mutateAsync({ id: deleteTarget.id });
      toast.success(res.message);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete record.");
    }
  }

  // ── QC toggles ────────────────────────────────────────
  const toggleField = useToggleField();
  const toggleQaqc = useQaqcToggle();

  // Custom centered confirmation for QA Done / Billable / Invoice Released
  // (replaces the native confirm() popup) — { label, next, run } or null.
  const [pendingToggle, setPendingToggle] = useState(null);
  function requestToggleConfirm(label, next, run) {
    setPendingToggle({ label, next, run });
  }

  // ── Hold view / info modals ───────────────────────────
  const [holdView, setHoldView] = useState(null);
  const [infoView, setInfoView] = useState(null);

  function toggleTeam(t) {
    setSelectedTeams((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
    setPage(1);
  }

  function toggleSort(col) {
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }));
    setPage(1);
  }

  function toggleDate(d) {
    setDates((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
    if (customRange.from || customRange.to) setCustomRange({ from: "", to: "" });
    setPage(1);
  }

  function openCustomRange() {
    setCustomRangeDraft(customRange);
    setCustomRangeOpen(true);
  }

  function applyCustomRange(e) {
    e.preventDefault();
    setCustomRange(customRangeDraft);
    if (customRangeDraft.from || customRangeDraft.to) setDates([]);
    setCustomRangeOpen(false);
    setPage(1);
  }

  function clearCustomRange() {
    setCustomRange({ from: "", to: "" });
    setCustomRangeDraft({ from: "", to: "" });
    setCustomRangeOpen(false);
    setPage(1);
  }

  return (
    <div>
      {user.birthday && <BirthdayPopup username={user.username} birthday={user.birthday} />}
      <DailyPopup username={user.username} role={user.role} />

      {canEdit && (
        <div className="card-form">
          <div className="section-title"><i className="bi bi-plus-circle" /> Add New Record</div>
          <form onSubmit={submitAdd} className="row g-2">
            <div className="col-md-3">
              <label className="form-label small mb-1">Project <span className="text-danger">*</span></label>
              <SearchableDropdown
                value={addForm.project}
                onChange={(v) => setAddForm((f) => ({ ...f, project: v }))}
                onSelect={(v) => {
                  const client = projectClientMap[v];
                  if (client) setAddForm((f) => ({ ...f, client }));
                }}
                options={meta.projects}
                placeholder="Project"
                required
              />
            </div>
            <div className="col-md-3">
              <label className="form-label small mb-1">Submission Name <span className="text-danger">*</span></label>
              <input className="form-control" placeholder="Submission Name" required value={addForm.submission_name} onChange={(e) => setAddForm((f) => ({ ...f, submission_name: e.target.value }))} />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Client <span className="text-danger">*</span></label>
              <SearchableDropdown value={addForm.client} onChange={(v) => setAddForm((f) => ({ ...f, client: v }))} options={meta.clients} placeholder="Client" required />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Team <span className="text-danger">*</span></label>
              <SearchableDropdown value={addForm.team} onChange={(v) => setAddForm((f) => ({ ...f, team: v }))} options={config?.selectableTeams || []} placeholder="Team" required />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Type <span className="text-danger">*</span></label>
              <select className="form-select" required value={addForm.submission_type} onChange={(e) => setAddForm((f) => ({ ...f, submission_type: e.target.value }))}>
                <option value="">Type…</option>
                {SUBMISSION_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Type of Submission</label>
              <select className="form-select" value={addForm.steel_type} onChange={(e) => setAddForm((f) => ({ ...f, steel_type: e.target.value }))}>
                <option value="">Type of Submission…</option>
                {STEEL_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Submission Date</label>
              <input type="date" className="form-control" value={addForm.sub_date} onChange={(e) => setAddForm((f) => ({ ...f, sub_date: e.target.value, due_date: e.target.value }))} />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Due Date</label>
              <input type="date" className="form-control" placeholder="Due date (auto)" value={addForm.due_date} onChange={(e) => setAddForm((f) => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div className="col-md-2">
              <label className="form-label small mb-1">Status</label>
              <select className="form-select" value={addForm.status_override} onChange={(e) => setAddForm((f) => ({ ...f, status_override: e.target.value }))}>
                <option value="">Auto</option>
                <option value="ON HOLD">ON HOLD</option>
                <option value="COMPLETED">COMPLETED</option>
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label small mb-1">Remarks</label>
              <input className="form-control" placeholder="Remarks" value={addForm.remarks} onChange={(e) => setAddForm((f) => ({ ...f, remarks: e.target.value }))} />
            </div>
            {canEditBillable && (
              <div className="col-md-2">
                <label className="form-label small mb-1">Billable</label>
                <select className="form-select" value={addForm.billable} onChange={(e) => setAddForm((f) => ({ ...f, billable: e.target.value }))}>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
            )}
            <div className="col-md-2 d-flex align-items-end">
              <button type="submit" className="btn btn-dark w-100" disabled={addMutation.isPending}>
                <i className="bi bi-plus-lg" /> Add Record
              </button>
            </div>
          </form>
        </div>
      )}

      {editing && (
        <div id="editPanel" className="visible">
          <div className="section-title">Edit Record #{editing.id}</div>
          <form onSubmit={submitEditRequest} className="row g-2">
            <div className="col-md-3">
              <label className="form-label small mb-1">Project <span className="text-danger">*</span></label>
              <SearchableDropdown
                value={editForm.project}
                onChange={(v) => setEditForm((f) => ({ ...f, project: v }))}
                onSelect={(v) => {
                  const client = projectClientMap[v];
                  if (client) setEditForm((f) => ({ ...f, client }));
                }}
                options={meta.projects}
                required
              />
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
              <label className="form-label small mb-1">Type of Submission</label>
              <select className="form-select" value={editForm.steel_type} onChange={(e) => setEditForm((f) => ({ ...f, steel_type: e.target.value }))}>
                <option value="">Type of Submission…</option>
                {STEEL_TYPES.map((t) => (
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
            {canEditPercentage && (
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
            )}
            {canEditBillable && (
              <div className="col-md-2">
                <label className="form-label small mb-1">Billable</label>
                <select className="form-select" value={editForm.billable} onChange={(e) => setEditForm((f) => ({ ...f, billable: e.target.value }))}>
                  <option value="">—</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
            )}
            {canEditInvoiceReleased && (
              <div className="col-md-2">
                <label className="form-label small mb-1">Invoice Released</label>
                <select className="form-select" value={editForm.invoice_released} onChange={(e) => setEditForm((f) => ({ ...f, invoice_released: e.target.value }))}>
                  <option value="">—</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
            )}
            <div className="col-md-2 d-flex align-items-end gap-2">
              <button type="submit" className="btn btn-primary flex-fill">Save</button>
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {config?.showTeamSelector !== false && (config?.selectableTeams || []).length > 0 && (
        <div className="card-form">
          <div className="section-title"><i className="bi bi-people" /> Select Teams</div>
          <div className="d-flex flex-wrap gap-2 align-items-center">
            {(config?.selectableTeams || []).map((t) => (
              <button
                key={t}
                type="button"
                className={`team-btn${(selectedTeams || []).includes(t) ? " selected" : ""}`}
                onClick={() => toggleTeam(t)}
              >
                <i className="bi bi-person-fill" />
                {t}
                {t === user.username ? " (you)" : ""}
              </button>
            ))}
          </div>
          <div className="d-flex gap-2 align-items-center mt-2">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setSelectedTeams(config.selectableTeams)}>
              <i className="bi bi-check2-all" /> Select All
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setSelectedTeams([])}>
              <i className="bi bi-x-circle" /> Clear
            </button>
            <span className="text-muted small ms-2">{(selectedTeams || []).length} selected</span>
          </div>
        </div>
      )}

      <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
        <div className="section-title mb-0"><i className="bi bi-table" /> Records ({data?.total ?? 0} record{data?.total === 1 ? "" : "s"})</div>
        <div className="ms-auto d-flex flex-wrap gap-2 align-items-center">
          <div className="position-relative">
            <button
              type="button"
              className={`date-btn custom-toggle${customRange.from || customRange.to ? " active custom" : ""}`}
              onClick={() => (customRangeOpen ? setCustomRangeOpen(false) : openCustomRange())}
            >
              <i className="bi bi-calendar-range" /> Custom
            </button>
            {customRangeOpen && (
              <form
                className="card-form position-absolute mt-1 p-2 shadow-sm"
                style={{ zIndex: 20, width: 260, top: "100%", left: 0 }}
                onSubmit={applyCustomRange}
              >
                <div className="mb-2">
                  <label className="form-label small mb-1">From</label>
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    value={customRangeDraft.from}
                    onChange={(e) => setCustomRangeDraft((f) => ({ ...f, from: e.target.value }))}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label small mb-1">To</label>
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    value={customRangeDraft.to}
                    onChange={(e) => setCustomRangeDraft((f) => ({ ...f, to: e.target.value }))}
                  />
                </div>
                <div className="d-flex gap-2">
                  <button type="submit" className="btn btn-sm btn-dark flex-fill">Apply</button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearCustomRange}>Clear</button>
                </div>
              </form>
            )}
          </div>
          <div className="date-btn-group">
            {["yesterday", "today", "tomorrow"].map((d) => (
              <button key={d} className={`date-btn${dates.includes(d) ? ` active ${d}` : ""}`} onClick={() => toggleDate(d)}>
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
          <div className="position-relative">
            <i className="bi bi-search position-absolute text-muted" style={{ left: 10, top: 8, fontSize: "0.8rem" }} />
            <input
              className="form-control"
              style={{ maxWidth: 220, paddingLeft: 28 }}
              placeholder="Search…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={reloadMasterLists}>
            <i className="bi bi-arrow-clockwise" /> Reload Lists
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table table-sm mb-0">
          <thead>
            <tr>
              <th>#</th>
              {[
                ["project", "Project"],
                ["submission", "Submission"],
                ["client", "Client"],
                ["type", "Type"],
                ["team", "Team"],
                ["sub_date", "Sub Date"],
                ["due_date", "Due Date"],
              ].map(([key, label]) => (
                <th key={key} onClick={() => toggleSort(key)}>
                  {label} {sort.col === key ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}
                </th>
              ))}
              <th>Remarks</th>
              <th onClick={() => toggleSort("status")}>Status {sort.col === "status" ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}</th>
              <th>Type of Submission</th>
              <th>Percentage</th>
              <th>QA Done</th>
              <th>Billable</th>
              <th>Invoice Released</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className={r.tag}>
                <td>{r.row_number}</td>
                <td><a className="proj-link" href={`/projects/${encodeURIComponent(r.project)}`}>{r.project}</a></td>
                <td><a href={`/projects/${encodeURIComponent(r.project)}`}>{r.submission_name}</a></td>
                <td><a className="client-link" href={`/clients/${encodeURIComponent(r.client)}`}>{r.client}</a></td>
                <td>{r.submission_type}</td>
                <td>{badgeTeam ? <span className="badge bg-dark">{r.team}</span> : r.team}</td>
                <td>{r.sub_date}</td>
                <td>{r.due_date}</td>
                <td>
                  {r.tag === "hold" && (r.hold_text || r.hold_image) ? (
                    <a href="#" className="text-decoration-underline" style={{ color: "#7c3aed" }} onClick={(e) => { e.preventDefault(); setHoldView(r); }}>
                      📎 {r.remarks || "note"}
                    </a>
                  ) : (
                    r.remarks
                  )}
                </td>
                <td><StatusBadge status={r.status} tag={r.tag} /></td>
                <td>{r.steel_type || "N/A"}</td>
                <td>
                  <PercentageCell value={r.percentage} />
                </td>
                <td>
                  <SwitchToggle label="QA Done" value={r.qaqc} disabled={!canQaqc} requestConfirm={requestToggleConfirm} onChange={(v) => toggleQaqc.mutate({ id: r.id, value: v })} />
                </td>
                <td>
                  <SwitchToggle label="Billable" value={r.billable} disabled={!canEditBillable} requestConfirm={requestToggleConfirm} onChange={(v) => toggleField.mutate({ id: r.id, field: "billable", value: v })} />
                </td>
                <td>
                  <SwitchToggle label="Invoice Released" value={r.invoice_released} disabled={!canEditInvoiceReleased} requestConfirm={requestToggleConfirm} onChange={(v) => toggleField.mutate({ id: r.id, field: "invoice_released", value: v })} />
                </td>
                <td className="text-nowrap">
                  <button className="btn btn-sm btn-outline-secondary" title="Info" onClick={() => setInfoView(r)}>
                    <i className="bi bi-info-circle" />
                  </button>
                  {canEditRecords && (
                    <button className="btn btn-sm btn-outline-primary ms-1" onClick={() => openEdit(r)}>
                      <i className="bi bi-pencil" />
                    </button>
                  )}
                  {canDeleteRecords && (
                    <button className="btn btn-sm btn-outline-danger ms-1" onClick={() => setDeleteTarget(r)}>
                      <i className="bi bi-trash" />
                    </button>
                  )}
                  {!canEditRecords && !canDeleteRecords && (
                    <button className="btn btn-sm btn-outline-secondary ms-1" disabled title="View only">
                      <i className="bi bi-eye-slash" />
                    </button>
                  )}
                  {r.tag === "hold" && (
                    <button
                      className="btn btn-sm btn-outline-secondary ms-1"
                      title="Edit hold attachment"
                      onClick={() => setHoldModal({ open: true, mode: "standalone", recordId: r.id, initial: { text: r.hold_text, image_filename: r.hold_image } })}
                    >
                      <i className="bi bi-paperclip" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!records.length && !isFetching && (
              <tr>
                <td colSpan={16} className="text-center text-muted py-4">
                  No records to show.
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

      <HoldAttachmentModal
        open={holdModal.open}
        onClose={() => setHoldModal({ open: false, mode: null, recordId: null, initial: null })}
        mode={holdModal.mode}
        recordId={holdModal.recordId}
        initial={holdModal.initial}
        onAttach={(note, file) => setPendingHold({ note, file })}
        onSaved={refetchRecords}
      />
      <HoldViewModal open={!!holdView} onClose={() => setHoldView(null)} record={holdView} />
      <RecordInfoModal open={!!infoView} onClose={() => setInfoView(null)} record={infoView} />

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

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Record"
        theme="danger"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={confirmDelete} disabled={deleteMutation.isPending}>Delete</button>
          </>
        }
      >
        <p className="mb-0">Delete record #{deleteTarget?.id} ({deleteTarget?.project})? This cannot be undone.</p>
      </Modal>
    </div>
  );
}
