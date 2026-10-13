"use client";
import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { api, ApiError } from "../lib/api";
import { useToast } from "../lib/ToastContext";

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtWhen(iso) {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Admin-only whole-system backup (every DB collection + uploaded files, zipped)
 * and restore. Opened from the navbar's "⋮" menu. The server also takes one
 * automatically every Sunday at 06:00 — see server/src/services/fullBackup.js.
 * Restore asks for the admin's password; the server takes a "pre-restore"
 * backup first, so a restore can be undone by restoring that one.
 */
export default function BackupModal({ open, onClose }) {
  const toast = useToast();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState("");
  // { name } for a stored backup, { file } for an uploaded one; null when the confirm dialog is closed.
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [password, setPassword] = useState("");
  const [restoring, setRestoring] = useState(false);
  const fileInput = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const d = await api.get("/backups");
      setBackups(d.backups);
      setCreating(d.running);
      setRestoring(d.restoring);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load backups.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function createNow() {
    setCreating(true);
    try {
      const d = await api.post("/backups");
      toast.success(`Backup created: ${d.backup.name}`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Backup failed.");
    } finally {
      setCreating(false);
    }
  }

  async function download(name) {
    setDownloading(name);
    try {
      await api.download(`/backups/${encodeURIComponent(name)}/download`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Download failed.");
    } finally {
      setDownloading("");
    }
  }

  function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires onChange
    if (file) openRestore({ file });
  }

  function openRestore(target) {
    setPassword("");
    setRestoreTarget(target);
  }

  async function confirmRestore(e) {
    e.preventDefault();
    setRestoring(true);
    try {
      let d;
      if (restoreTarget.file) {
        const form = new FormData();
        form.append("file", restoreTarget.file);
        form.append("password", password);
        d = await api.post("/backups/restore-upload", form);
      } else {
        d = await api.post(`/backups/${encodeURIComponent(restoreTarget.name)}/restore`, { password });
      }
      toast.success(`Restore complete. A copy of the previous data was saved as ${d.safetyBackup}. Reloading…`);
      setRestoreTarget(null);
      // Every page's data just changed underneath it — reload rather than leave stale state around.
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Restore failed.");
      setRestoring(false);
    }
  }

  const busy = creating || restoring;
  const restoreLabel = restoreTarget?.file ? restoreTarget.file.name : restoreTarget?.name;

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={<><i className="bi bi-database-fill-down" /> Full Backup</>}
      maxWidth={640}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <input ref={fileInput} type="file" accept=".zip" className="d-none" onChange={pickFile} />
          <button type="button" className="btn btn-outline-danger me-auto" onClick={() => fileInput.current?.click()} disabled={busy}>
            <i className="bi bi-upload" /> Restore from File…
          </button>
          <button type="button" className="btn btn-primary" onClick={createNow} disabled={busy}>
            {creating
              ? <><span className="spinner-border spinner-border-sm me-1" /> Backing up…</>
              : <><i className="bi bi-plus-circle" /> Create Backup Now</>}
          </button>
        </>
      }
    >
      <p className="small text-muted mb-3">
        <i className="bi bi-info-circle" /> Includes every database collection and all uploaded files.
        Runs automatically every <strong>Sunday at 6:00 AM</strong>; the most recent backups are kept.
      </p>
      {restoring && (
        <div className="alert alert-warning py-2 small">
          <span className="spinner-border spinner-border-sm me-1" /> A restore is in progress…
        </div>
      )}

      {loading ? (
        <div className="text-center py-3"><div className="spinner-border spinner-border-sm text-secondary" /></div>
      ) : backups.length === 0 ? (
        <div className="text-center text-muted py-3">No backups yet.</div>
      ) : (
        <table className="table table-sm align-middle mb-0">
          <thead>
            <tr><th>Created</th><th>Size</th><th /></tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.name}>
                <td>
                  {fmtWhen(b.createdAt)}
                  <div className="small text-muted">{b.name}</div>
                </td>
                <td>{fmtSize(b.size)}</td>
                <td className="text-end text-nowrap">
                  <button type="button" className="btn btn-sm btn-outline-primary me-1" onClick={() => download(b.name)} disabled={!!downloading}>
                    <i className="bi bi-download" /> {downloading === b.name ? "Downloading…" : "Download"}
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => openRestore({ name: b.name })} disabled={busy}>
                    <i className="bi bi-arrow-counterclockwise" /> Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>

    <Modal
      open={!!restoreTarget}
      onClose={() => !restoring && setRestoreTarget(null)}
      title={<><i className="bi bi-exclamation-triangle-fill" /> Restore Backup</>}
      theme="danger"
      maxWidth={520}
      aboveModals
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => setRestoreTarget(null)} disabled={restoring}>Cancel</button>
          <button type="submit" form="backup-restore-form" className="btn btn-danger" disabled={restoring || !password}>
            {restoring
              ? <><span className="spinner-border spinner-border-sm me-1" /> Restoring…</>
              : <><i className="bi bi-arrow-counterclockwise" /> Restore</>}
          </button>
        </>
      }
    >
      <form id="backup-restore-form" onSubmit={confirmRestore}>
        <p className="mb-2">
          Restore <strong className="text-break">{restoreLabel}</strong>?
        </p>
        <div className="alert alert-danger small py-2">
          <strong>All current data</strong> (records, change orders, RFIs, users, settings, logs) and uploaded files
          will be <strong>replaced</strong> with the contents of this backup. Anything added since it was taken will be gone.
          A backup of the current data is taken automatically first, so this can be undone.
        </div>
        <label className="form-label">Enter your password to confirm</label>
        <input
          type="password"
          className="form-control"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          disabled={restoring}
        />
      </form>
    </Modal>
    </>
  );
}
