"use client";
import { useEffect, useState } from "react";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import { api, ApiError } from "../../lib/api";

export default function BulkUploadPage() {
  const [collections, setCollections] = useState([]);
  const [collection, setCollection] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [sampleBusy, setSampleBusy] = useState(false);

  useEffect(() => {
    api.get("/bulk-upload/collections").then((d) => {
      setCollections(d.collections || []);
      if (d.collections?.length) setCollection(d.collections[0].key);
    });
  }, []);

  const selected = collections.find((c) => c.key === collection);

  async function handleDownloadSample() {
    if (!collection) return;
    setSampleBusy(true);
    try {
      await api.download(`/bulk-upload/sample/${collection}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download sample.");
    } finally {
      setSampleBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!collection || !file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("collection", collection);
      fd.append("file", file);
      const data = await api.post("/bulk-upload", fd);
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppLayout allow={["admin"]}>
      <PageHero
        theme="indigo"
        icon="bi-cloud-upload-fill"
        title="Bulk Upload"
        meta="Import CSV data straight into a MongoDB collection"
      />

      <div className="card-form" style={{ maxWidth: 640 }}>
        <form onSubmit={handleSubmit}>
          <label className="form-label">Target Collection</label>
          <select className="form-select mb-2" value={collection} onChange={(e) => { setCollection(e.target.value); setResult(null); }}>
            {collections.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          {selected && (
            <div className="mb-3">
              <p className="text-muted small mb-1">
                Expected column order (no header row): <code>{selected.columns}</code>
              </p>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={handleDownloadSample} disabled={sampleBusy}>
                <i className="bi bi-file-earmark-excel" /> {sampleBusy ? "Preparing…" : "Download Sample (.xlsx)"}
              </button>
            </div>
          )}

          <label className="form-label">CSV File</label>
          <input type="file" className="form-control mb-3" accept=".csv" onChange={(e) => setFile(e.target.files?.[0])} required />

          <button type="submit" className="btn btn-dark" disabled={busy || !file}>
            <i className="bi bi-upload" /> {busy ? "Uploading…" : "Upload"}
          </button>
        </form>

        {error && <div className="alert alert-danger mt-3">{error}</div>}

        {result && (
          <div className="alert alert-success mt-3">
            <div className="fw-bold mb-1">
              <i className="bi bi-check-circle" /> Upload complete for <code>{result.collection}</code>
            </div>
            <div>Inserted: {result.inserted} &nbsp;|&nbsp; Updated: {result.updated} &nbsp;|&nbsp; Skipped: {result.skipped}</div>
            {result.note && <div className="text-muted small mt-1">{result.note}</div>}
            {result.errors?.length > 0 && (
              <details className="mt-2">
                <summary className="text-danger" style={{ cursor: "pointer" }}>{result.errors.length} error(s) — click to view</summary>
                <ul className="small mb-0 mt-1">
                  {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
                {result.errors.length > 20 && <div className="small text-muted">…and {result.errors.length - 20} more</div>}
              </details>
            )}
          </div>
        )}
      </div>

      <div className="card-form" style={{ maxWidth: 640 }}>
        <div className="section-title"><i className="bi bi-info-circle" /> Notes</div>
        <ul className="small text-muted mb-0">
          <li>Files must be plain CSV with <strong>no header row</strong> — columns in the exact order shown above (matches a direct Postgres <code>COPY ... TO CSV</code> export).</li>
          <li><strong>Records</strong> and <strong>Users</strong> are upserted by their natural key (record ID / username) — safe to re-run.</li>
          <li><strong>Records</strong>: set the <code>billable</code> column to <code>Yes</code>/<code>true</code>/<code>1</code> to auto-create a Change Order for that submission, exactly like the Add/Edit Record form does — re-running the upload won&apos;t create duplicates for a record that already has one.</li>
          <li><strong>Records</strong>: <code>invoice_released</code> accepts <code>Yes</code>/<code>No</code> (or blank) and <code>percentage</code> accepts a whole number 0–100 — both map onto the same fields the Management/Records views already show. Note the column order: <code>percentage</code> comes before <code>billable</code>, which comes before <code>invoice_released</code>.</li>
          <li><strong>Teams / Projects / Clients</strong> are upserted by name.</li>
          <li><strong>Clients &amp; Projects</strong>: one row per project (<code>client, project</code>) — creates the client and project if new, and links the project to that client. Repeat the client name on multiple rows to give it several projects.</li>
          <li>The <strong>Download Sample (.xlsx)</strong> button gives you a template with a header row and a couple of example rows for whichever collection is selected — delete the header row and save as CSV before uploading.</li>
          <li><strong>Users</strong> also links to <strong>Teams</strong>: any name in the <code>allowed_teams</code> column that doesn&apos;t already exist as a Team is created automatically.</li>
          <li><strong>Activity Log / Completed Log / Editing Log / Request Log</strong> are pure event history — each upload appends new rows, so avoid uploading the same file twice.</li>
          <li><strong>Hold Data</strong> merges into the matching record&apos;s hold attachment fields — it does not copy the actual image files, only the filename reference.</li>
        </ul>
      </div>
    </AppLayout>
  );
}
