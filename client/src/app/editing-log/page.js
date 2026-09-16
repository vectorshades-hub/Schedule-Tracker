"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import StatPill from "../../components/StatPill";
import Modal from "../../components/Modal";
import SearchableDropdown from "../../components/SearchableDropdown";
import AccessChipsPanel from "../../components/AccessChipsPanel";
import EditingLogGrid from "../../components/EditingLogGrid";
import { useAuth } from "../../lib/AuthContext";
import { api, ApiError, API_URL, SERVER_ORIGIN } from "../../lib/api";
import { useToast } from "../../lib/ToastContext";

const DONE_FIELDS = { detailed_by_done: "Detailed By", checked_by_done: "Checked By", corrected_by_done: "Corrected By", qc_comment_done: "QC Comment" };

// Drag-select + Ctrl+D/Ctrl+Enter fill-down over the saved-rows table, mirroring
// EditingLogGrid's pre-save version — but each fill here has to persist through
// /update-cell per affected cell, since these rows are already in the DB.
const FILL_COLS = ["detailed_by", "checked_by", "corrected_by", "qc_done", "qc_comment"];

function normFillRange(s) {
  if (!s) return null;
  return { r1: Math.min(s.r1, s.r2), r2: Math.max(s.r1, s.r2), c1: Math.min(s.c1, s.c2), c2: Math.max(s.c1, s.c2) };
}

export default function EditingLogPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: meta } = useQuery({ queryKey: ["editing-log-meta"], queryFn: () => api.get("/editing-log/meta"), enabled: !!user });

  const [selProject, setSelProject] = useState("");
  const [selClient, setSelClient] = useState("");
  const [sheetType, setSheetType] = useState("");
  const [search, setSearch] = useState("");
  const [qcFilter, setQcFilter] = useState("");
  const [page, setPage] = useState(1);

  const listParams = { project: selProject, client: selClient, sheet_type: sheetType, search, qc: qcFilter, page };
  const { data: listing, refetch: refetchListing } = useQuery({
    queryKey: ["editing-log", listParams],
    queryFn: () => api.get("/editing-log", listParams),
    enabled: !!user,
  });

  const pairs = listing?.pairs || [];
  const clients = [...new Set(pairs.map((p) => p.client))].sort();
  const projectsForClient = pairs.filter((p) => !selClient || p.client === selClient);

  // ── Upload flow ───────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(!pairs.length);
  const [upForm, setUpForm] = useState({ project: "", client: "" });
  const [file, setFile] = useState(null);
  const [parseError, setParseError] = useState("");
  const [gridRows, setGridRows] = useState(null);
  const [gridFilename, setGridFilename] = useState("");
  const [accessChecked, setAccessChecked] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!meta || !user) return;
    const defaults = new Set(meta.default_upload_users || []);
    const cascade = user.role === "management" ? meta.mgmt_tl_map?.[user.username] || [] : [];
    setAccessChecked([...new Set([...defaults, ...cascade].filter((u) => (meta.access_user_names || []).includes(u)))]);
  }, [meta, user]);

  async function handleParse(e) {
    e.preventDefault();
    setParseError("");
    if (!upForm.project || !upForm.client || !file) {
      setParseError("Project, client and a file are all required.");
      return;
    }
    const fd = new FormData();
    fd.append("excel_file", file);
    try {
      const res = await api.post("/editing-log/parse", fd);
      if (!res.rows?.length) {
        setParseError("No Detail/Erection sheet names found in that file.");
        return;
      }
      setGridRows(res.rows);
      setGridFilename(res.filename);
    } catch (err) {
      setParseError(err instanceof ApiError ? err.message : "Failed to parse file.");
    }
  }

  async function handleSaveRows() {
    setBusy(true);
    try {
      const res = await api.post("/editing-log/save-rows", {
        project: upForm.project,
        client: upForm.client,
        filename: gridFilename,
        rows: gridRows,
        allowed_users: accessChecked,
      });
      toast.success(`${res.saved} rows saved.`);
      setGridRows(null);
      setUploadOpen(false);
      setSelProject(upForm.project);
      setSelClient(upForm.client);
      qc.invalidateQueries({ queryKey: ["editing-log"] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save.");
    } finally {
      setBusy(false);
    }
  }

  // ── Drag-select + fill-down (Ctrl+D / Ctrl+Enter) over the saved rows table ──
  const [fillSel, setFillSel] = useState(null); // {r1,c1,r2,c2} in FILL_COLS/rows index space
  const [fillAnchor, setFillAnchor] = useState(null);
  const [filling, setFilling] = useState(false);
  const normFillSel = normFillRange(fillSel);

  useEffect(() => {
    setFillSel(null);
    setFillAnchor(null);
  }, [page, selProject, selClient, search, qcFilter, sheetType]);

  function startFillSelect(r, c) {
    setFillAnchor({ r, c });
    setFillSel({ r1: r, c1: c, r2: r, c2: c });
  }
  function extendFillSelect(r, c) {
    if (!fillAnchor) return;
    setFillSel({ r1: fillAnchor.r, c1: fillAnchor.c, r2: r, c2: c });
  }
  function isFillSelected(r, c) {
    return !!normFillSel && r >= normFillSel.r1 && r <= normFillSel.r2 && c >= normFillSel.c1 && c <= normFillSel.c2;
  }

  async function handleFillKeyDown(e) {
    if (!normFillSel) return;
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (!mod || (key !== "d" && key !== "enter")) return;
    e.preventDefault();

    const rows = listing?.rows || [];
    const updates = [];
    for (let c = normFillSel.c1; c <= normFillSel.c2; c++) {
      const field = FILL_COLS[c];
      const topRow = rows[normFillSel.r1];
      if (!topRow) continue;
      const value = topRow[field] ?? "";
      for (let r = normFillSel.r1 + 1; r <= normFillSel.r2; r++) {
        const targetRow = rows[r];
        if (!targetRow || (targetRow[field] ?? "") === value) continue;
        updates.push({ id: targetRow.id, field, value });
      }
    }
    if (!updates.length) return;
    setFilling(true);
    try {
      await Promise.all(updates.map((u) => api.post("/editing-log/update-cell", { id: u.id, field: u.field, value: u.value })));
      refetchListing();
      toast.success(`Filled ${updates.length} cell${updates.length === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Fill failed.");
    } finally {
      setFilling(false);
    }
  }

  // ── Inline cell edit (double-click) ──────────────────
  const [editingCell, setEditingCell] = useState(null); // { id, field, value }
  async function saveCell() {
    try {
      await api.post("/editing-log/update-cell", { id: editingCell.id, field: editingCell.field, value: editingCell.value });
      setEditingCell(null);
      refetchListing();
      toast.success("Saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save.");
    }
  }

  async function toggleDone(row, field) {
    const current = row[field] === "1";
    if (current) {
      await api.post("/editing-log/update-cell", { id: row.id, field, value: "0" });
      refetchListing();
      return;
    }
    if (!confirm(`Mark ${DONE_FIELDS[field]} as done?`)) return;
    await api.post("/editing-log/update-cell", { id: row.id, field, value: "1" });
    refetchListing();
  }

  // ── Edit row modal ────────────────────────────────────
  const [editRow, setEditRow] = useState(null);
  const [editRowForm, setEditRowForm] = useState(null);
  function openEditRow(row) {
    const isOwner = user.role === "admin" || user.username === row.uploaded_by;
    setEditRow({ ...row, isOwner });
    setEditRowForm({ ...row });
  }
  async function saveEditRow() {
    try {
      const payload = {
        id: editRow.id,
        detailed_by: editRowForm.detailed_by,
        checked_by: editRowForm.checked_by,
        corrected_by: editRowForm.corrected_by,
        qc_done: editRowForm.qc_done,
        qc_comment: editRowForm.qc_comment,
        remarks: editRowForm.remarks,
      };
      if (editRow.isOwner) {
        payload.sheet_name = editRowForm.sheet_name;
        payload.sheet_type = editRowForm.sheet_type;
        payload.project = editRowForm.project;
        payload.client = editRowForm.client;
        payload.allowed_users = editRowForm.allowed_users;
      }
      await api.post("/editing-log/edit-row", payload);
      setEditRow(null);
      refetchListing();
      toast.success("Row updated.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save.");
    }
  }

  // ── Edit project (bulk rename) modal ─────────────────
  const [epOpen, setEpOpen] = useState(false);
  const [epForm, setEpForm] = useState(null);
  function openEditProject() {
    const first = listing?.rows?.[0];
    setEpForm({ old_project: selProject, old_client: selClient, new_project: selProject, new_client: selClient, allowed_users: first?.allowed_users || [] });
    setEpOpen(true);
  }
  async function saveEditProject() {
    try {
      await api.post("/editing-log/rename-project", epForm);
      setEpOpen(false);
      setSelProject(epForm.new_project);
      setSelClient(epForm.new_client);
      qc.invalidateQueries({ queryKey: ["editing-log"] });
      toast.success("Project renamed.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to rename.");
    }
  }

  // ── Bulk edit (re-import) modal ───────────────────────
  const [bulkOpen, setBulkOpen] = useState(false);

  // Guard placed after every hook call above (Rules of Hooks) — this page reads `user`
  // directly rather than via a child of <AppLayout>, so it renders before AppLayout's own
  // auth gate does; bail out here while auth is still loading (also makes the page SSG-safe).
  if (!user) return null;

  async function handleBulkFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("excel_file", f);
    try {
      const res = await api.post("/editing-log/bulk-edit", fd);
      toast.success(`Updated: ${res.updated}, skipped: ${res.skipped}`);
      setBulkOpen(false);
      refetchListing();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Bulk edit failed.");
    }
    e.target.value = "";
  }

  async function handleExport() {
    try {
      await api.download("/editing-log/export", { method: "POST", body: { project: selProject, client: selClient, sheet_type: sheetType, qc: qcFilter } });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed.");
    }
  }

  return (
    <AppLayout>
      <PageHero
        theme="indigo"
        icon="bi-pencil-square"
        title="Editing Log"
        meta={`${listing?.total ?? 0} rows`}
        right={
          <>
            <button className="btn btn-sm btn-light" onClick={handleExport}><i className="bi bi-download" /> Export</button>
            <button className="btn btn-sm btn-light" onClick={() => setBulkOpen(true)}><i className="bi bi-arrow-repeat" /> Bulk Edit</button>
            <button className="btn btn-sm btn-warning" onClick={() => setUploadOpen((v) => !v)}>
              <i className="bi bi-cloud-arrow-up" /> Upload & Edit
            </button>
            <a className="btn btn-sm btn-light" href={`${SERVER_ORIGIN}/static/py_files/Get_D_E_Sheet.py`} target="_blank" rel="noreferrer" title="Run inside SDS2 to generate the Excel sheet">
              <i className="bi bi-file-code" /> Download Script
            </a>
          </>
        }
      />

      {uploadOpen && (
        <div className="card-form">
          {!gridRows ? (
            <>
              <div className="section-title">Step 1 — Load Excel File</div>
              {parseError && <div className="alert alert-danger py-2">{parseError}</div>}
              <form onSubmit={handleParse} className="row g-2">
                <div className="col-md-4">
                  <SearchableDropdown value={upForm.project} onChange={(v) => setUpForm((f) => ({ ...f, project: v }))} options={meta?.projects || []} placeholder="Project" />
                </div>
                <div className="col-md-4">
                  <SearchableDropdown value={upForm.client} onChange={(v) => setUpForm((f) => ({ ...f, client: v }))} options={meta?.clients || []} placeholder="Client" />
                </div>
                <div className="col-md-3">
                  <input type="file" className="form-control" accept=".xlsx,.xls,.xlsm" onChange={(e) => setFile(e.target.files?.[0])} />
                </div>
                <div className="col-md-1">
                  <button type="submit" className="btn btn-primary w-100">Load</button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div>
                  <span className="badge bg-secondary me-2">{upForm.project}</span>
                  <span className="badge bg-secondary me-2">{upForm.client}</span>
                  <span className="badge bg-light text-dark">{gridFilename}</span>
                  <span className="badge bg-info text-dark ms-2">{gridRows.length} rows</span>
                </div>
                <div className="d-flex gap-2">
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => setGridRows(null)}>Back</button>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveRows} disabled={busy}>
                    Save {gridRows.length} Rows
                  </button>
                </div>
              </div>
              <div className="mb-2">
                <div className="fw-semibold small mb-1">Who can view this upload?</div>
                <AccessChipsPanel
                  uploaderName={user.username}
                  users={meta?.access_user_names || []}
                  checked={accessChecked}
                  onChange={setAccessChecked}
                  mgmtTlMap={meta?.mgmt_tl_map}
                  defaultTl={meta?.current_user?.default_tl}
                />
              </div>
              <p className="text-muted small">Click a cell then drag to select a range. Ctrl+C / Ctrl+V copy & paste as TSV, Ctrl+D fills the selection down from its top row.</p>
              <EditingLogGrid rows={gridRows} onChange={setGridRows} />
            </>
          )}
        </div>
      )}

      {pairs.length > 0 && (
        <div className="selector-card">
          <div className="section-title"><i className="bi bi-diagram-3" /> Select Project &amp; Client</div>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <select className="form-select" style={{ maxWidth: 220 }} value={selClient} onChange={(e) => { setSelClient(e.target.value); setSelProject(""); setPage(1); }}>
              <option value="">Select client…</option>
              {clients.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="form-select" style={{ maxWidth: 260 }} value={selProject} onChange={(e) => { setSelProject(e.target.value); setPage(1); }} disabled={!selClient}>
              <option value="">Select project…</option>
              {projectsForClient.map((p) => <option key={`${p.client}__${p.project}`} value={p.project}>{p.project} ({p.count} rows)</option>)}
            </select>
          </div>
          {selProject && selClient && (
            <div className="selector-current">
              <span className="fw-bold">{selProject}</span>
              <span className="opacity-50">/</span>
              <span>{selClient}</span>
              <span className="sel-cnt">{listing?.total ?? 0} rows</span>
              <a href="#" className="ms-auto text-white-50 small" onClick={(e) => { e.preventDefault(); setSelProject(""); setSelClient(""); }}>
                <i className="bi bi-x-circle" /> Clear
              </a>
              {["admin", "management"].includes(user.role) && (
                <button className="btn btn-sm" style={{ background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.3)", color: "#fff" }} onClick={openEditProject}>
                  <i className="bi bi-pencil" /> Edit Project
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {selProject && selClient && (
        <>
          <div className="stats-bar">
            <StatPill num={listing?.total ?? 0} label="Total" />
            <StatPill num={listing?.stats?.qc_yes ?? 0} label="QC Yes" color="#198754" />
            <StatPill num={listing?.stats?.qc_no ?? 0} label="QC No" color="#dc3545" />
            <StatPill num={listing?.stats?.detail_cnt ?? 0} label="Detail" color="#1a237e" />
            <StatPill num={listing?.stats?.erection_cnt ?? 0} label="Erection" color="#0f766e" />
          </div>

          <div className="filter-bar d-flex flex-wrap gap-2">
            <select className="form-select" style={{ maxWidth: 160 }} value={sheetType} onChange={(e) => { setSheetType(e.target.value); setPage(1); }}>
              <option value="">All types</option>
              <option value="Detail">Detail</option>
              <option value="Erection">Erection</option>
            </select>
            <input className="form-control" style={{ maxWidth: 220 }} placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <select className="form-select" style={{ maxWidth: 140 }} value={qcFilter} onChange={(e) => { setQcFilter(e.target.value); setPage(1); }}>
              <option value="">Any QC</option>
              <option value="yes">QC Yes</option>
              <option value="no">QC No</option>
            </select>
          </div>

          <p className="text-muted small mb-1">
            Click a cell in Detailed By/Checked By/Corrected By/QC Done/QC Cmt Updated then drag to select a range. Ctrl+D or Ctrl+Enter fills the selection down from its top row.
            {filling && <span className="ms-2"><i className="bi bi-arrow-repeat" /> Filling…</span>}
          </p>
          <div className="table-wrap theme-indigo" tabIndex={0} onKeyDown={handleFillKeyDown} style={{ outline: "none" }}>
            <table className="table table-sm mb-0" style={{ userSelect: "none" }}>
              <thead>
                <tr>
                  <th>#</th><th>Sheet Name</th><th>Type</th><th>Detailed By</th><th>Checked By</th><th>Corrected By</th>
                  <th>QC Done</th><th>QC Cmt Updated</th><th>Remarks</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(listing?.rows || []).map((row, i) => (
                  <tr key={row.id}>
                    <td>{(page - 1) * (listing?.page_size || 25) + i + 1}</td>
                    <td>{row.sheet_name}</td>
                    <td><span className={`badge badge-${row.sheet_type?.toLowerCase()}`}>{row.sheet_type}</span></td>
                    {["detailed_by", "checked_by", "corrected_by"].map((field, c) => (
                      <EditableCell
                        key={field}
                        row={row}
                        field={field}
                        editingCell={editingCell}
                        setEditingCell={setEditingCell}
                        onSave={saveCell}
                        doneField={`${field}_done`}
                        onToggleDone={() => toggleDone(row, `${field}_done`)}
                        userNames={meta?.access_user_names}
                        isSelected={isFillSelected(i, c)}
                        onCellMouseDown={() => startFillSelect(i, c)}
                        onCellMouseEnter={(e) => e.buttons === 1 && extendFillSelect(i, c)}
                      />
                    ))}
                    <td
                      style={isFillSelected(i, 3) ? { outline: "2px solid #4da6ff", background: "#eaf4ff" } : undefined}
                      onMouseDown={() => startFillSelect(i, 3)}
                      onMouseEnter={(e) => e.buttons === 1 && extendFillSelect(i, 3)}
                      onDoubleClick={() => setEditingCell({ id: row.id, field: "qc_done", value: row.qc_done })}
                    >
                      {editingCell?.id === row.id && editingCell.field === "qc_done" ? (
                        <select autoFocus className="form-select form-select-sm" value={editingCell.value} onBlur={saveCell} onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}>
                          <option value=""></option><option value="Yes">Yes</option><option value="No">No</option>
                        </select>
                      ) : (
                        <span className={row.qc_done === "Yes" ? "text-success fw-bold" : row.qc_done === "No" ? "text-danger fw-bold" : ""}>
                          {row.qc_done || "—"}
                        </span>
                      )}
                    </td>
                    <EditableCell
                      row={row}
                      field="qc_comment"
                      editingCell={editingCell}
                      setEditingCell={setEditingCell}
                      onSave={saveCell}
                      doneField="qc_comment_done"
                      onToggleDone={() => toggleDone(row, "qc_comment_done")}
                      userNames={meta?.qaqc_admin_usernames}
                      isSelected={isFillSelected(i, 4)}
                      onCellMouseDown={() => startFillSelect(i, 4)}
                      onCellMouseEnter={(e) => e.buttons === 1 && extendFillSelect(i, 4)}
                    />
                    <td onDoubleClick={() => setEditingCell({ id: row.id, field: "remarks", value: row.remarks })}>
                      {editingCell?.id === row.id && editingCell.field === "remarks" ? (
                        <input autoFocus className="form-control form-control-sm" value={editingCell.value} onBlur={saveCell} onKeyDown={(e) => e.key === "Enter" && saveCell()} onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })} />
                      ) : row.remarks}
                    </td>
                    <td>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => openEditRow(row)}><i className="bi bi-pencil" /></button>
                    </td>
                  </tr>
                ))}
                {!listing?.rows?.length && <tr><td colSpan={10} className="text-center text-muted py-4">No rows.</td></tr>}
              </tbody>
            </table>
          </div>

          {listing?.pages > 1 && (
            <nav className="mt-2">
              <ul className="pagination pagination-sm">
                {Array.from({ length: listing.pages }, (_, i) => i + 1).map((p) => (
                  <li key={p} className={`page-item${p === page ? " active" : ""}`}>
                    <button className="page-link" onClick={() => setPage(p)}>{p}</button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </>
      )}

      {editRow && editRowForm && (
        <Modal open onClose={() => setEditRow(null)} title={`Edit Row — ${editRow.sheet_name}`} theme="indigo" footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditRow(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveEditRow}>Save</button>
          </>
        }>
          {editRow.isOwner && (
            <div className="row g-2 mb-2">
              <div className="col-6"><label className="form-label">Project</label><input className="form-control" value={editRowForm.project} onChange={(e) => setEditRowForm((f) => ({ ...f, project: e.target.value }))} /></div>
              <div className="col-6"><label className="form-label">Client</label><input className="form-control" value={editRowForm.client} onChange={(e) => setEditRowForm((f) => ({ ...f, client: e.target.value }))} /></div>
              <div className="col-6"><label className="form-label">Sheet Name</label><input className="form-control" value={editRowForm.sheet_name} onChange={(e) => setEditRowForm((f) => ({ ...f, sheet_name: e.target.value }))} /></div>
              <div className="col-6">
                <label className="form-label">Sheet Type</label>
                <select className="form-select" value={editRowForm.sheet_type} onChange={(e) => setEditRowForm((f) => ({ ...f, sheet_type: e.target.value }))}>
                  <option value="Detail">Detail</option><option value="Erection">Erection</option>
                </select>
              </div>
            </div>
          )}
          <div className="row g-2 mb-2">
            <div className="col-6"><label className="form-label">Detailed By</label><input className="form-control" value={editRowForm.detailed_by} onChange={(e) => setEditRowForm((f) => ({ ...f, detailed_by: e.target.value }))} /></div>
            <div className="col-6"><label className="form-label">Checked By</label><input className="form-control" value={editRowForm.checked_by} onChange={(e) => setEditRowForm((f) => ({ ...f, checked_by: e.target.value }))} /></div>
            <div className="col-6"><label className="form-label">Corrected By</label><input className="form-control" value={editRowForm.corrected_by} onChange={(e) => setEditRowForm((f) => ({ ...f, corrected_by: e.target.value }))} /></div>
            <div className="col-6">
              <label className="form-label">QC Done</label>
              <select className="form-select" value={editRowForm.qc_done} onChange={(e) => setEditRowForm((f) => ({ ...f, qc_done: e.target.value }))}>
                <option value=""></option><option value="Yes">Yes</option><option value="No">No</option>
              </select>
            </div>
            <div className="col-12"><label className="form-label">QC Comment</label><input className="form-control" value={editRowForm.qc_comment} onChange={(e) => setEditRowForm((f) => ({ ...f, qc_comment: e.target.value }))} /></div>
            <div className="col-12"><label className="form-label">Remarks</label><input className="form-control" value={editRowForm.remarks} onChange={(e) => setEditRowForm((f) => ({ ...f, remarks: e.target.value }))} /></div>
          </div>
          {editRow.isOwner && (
            <>
              <div className="fw-semibold small mb-1">Access</div>
              <AccessChipsPanel uploaderName={editRow.uploaded_by} users={meta?.access_user_names || []} checked={editRowForm.allowed_users || []} onChange={(v) => setEditRowForm((f) => ({ ...f, allowed_users: v }))} mgmtTlMap={meta?.mgmt_tl_map} />
            </>
          )}
        </Modal>
      )}

      {epOpen && epForm && (
        <Modal open onClose={() => setEpOpen(false)} title="Edit Project / Client" theme="indigo" footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEpOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveEditProject}>Save</button>
          </>
        }>
          <div className="row g-2 mb-2">
            <div className="col-6"><label className="form-label">New Project</label><input className="form-control" value={epForm.new_project} onChange={(e) => setEpForm((f) => ({ ...f, new_project: e.target.value }))} /></div>
            <div className="col-6"><label className="form-label">New Client</label><input className="form-control" value={epForm.new_client} onChange={(e) => setEpForm((f) => ({ ...f, new_client: e.target.value }))} /></div>
          </div>
          <div className="fw-semibold small mb-1">Access (applies to all rows in this batch)</div>
          <AccessChipsPanel uploaderName="—" users={meta?.access_user_names || []} checked={epForm.allowed_users} onChange={(v) => setEpForm((f) => ({ ...f, allowed_users: v }))} mgmtTlMap={meta?.mgmt_tl_map} />
        </Modal>
      )}

      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Bulk Edit (re-import)" theme="indigo">
        <p className="text-muted small">Export the current view, edit it in Excel, then re-upload it here. Rows are matched by the hidden ID column — don&apos;t modify it.</p>
        <input type="file" className="form-control" accept=".xlsx,.xls,.xlsm" onChange={handleBulkFile} />
      </Modal>
    </AppLayout>
  );
}

function EditableCell({ row, field, editingCell, setEditingCell, onSave, doneField, onToggleDone, userNames, isSelected, onCellMouseDown, onCellMouseEnter }) {
  const isEditing = editingCell?.id === row.id && editingCell.field === field;
  const doneClass = row[doneField] === "1" ? "bg-warning-subtle" : "";
  return (
    <td
      className={doneClass}
      style={isSelected ? { outline: "2px solid #4da6ff", background: "#eaf4ff" } : undefined}
      onDoubleClick={() => setEditingCell({ id: row.id, field, value: row[field] })}
      onMouseDown={onCellMouseDown}
      onMouseEnter={onCellMouseEnter}
    >
      {isEditing ? (
        <input
          autoFocus
          className="form-control form-control-sm"
          list={`dl-${field}`}
          value={editingCell.value}
          onBlur={onSave}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
        />
      ) : (
        <span className="d-flex justify-content-between align-items-center">
          {row[field] || "—"}
          <button type="button" className="btn btn-sm btn-link p-0 ms-1" title="Toggle done" onClick={onToggleDone}>
            <i className={`bi ${row[doneField] === "1" ? "bi-check-circle-fill text-success" : "bi-circle text-muted"}`} />
          </button>
        </span>
      )}
      <datalist id={`dl-${field}`}>{(userNames || []).map((u) => <option key={u} value={u} />)}</datalist>
    </td>
  );
}
