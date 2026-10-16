"use client";
import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import SearchableDropdown from "./SearchableDropdown";
import ImageLightboxModal from "./ImageLightboxModal";
import { useSaveIssue, useDeleteIssueAttachment, issueAttachmentUrl } from "../hooks/useIssues";
import { useToast } from "../lib/ToastContext";
import { ApiError } from "../lib/api";

export const ISSUE_STATUSES = [
  { value: "Under Review", cls: "review", icon: "bi-hourglass-split", hint: "Not yet classified" },
  { value: "Our Error", cls: "ours", icon: "bi-exclamation-triangle-fill", hint: "The issue was caused by us" },
  { value: "Not Our Error", cls: "notours", icon: "bi-shield-check", hint: "Not caused by us" },
];

const ACCEPT = "image/*,.pdf,.eml,.msg";
const today = () => new Date().toISOString().slice(0, 10);

function emptyForm() {
  return {
    title: "",
    received_date: today(),
    project: "",
    client: "",
    reported_by: "",
    description: "",
    status: "Under Review",
    response_date: "",
    response_notes: "",
  };
}

function fromIssue(issue) {
  return {
    title: issue.title,
    received_date: issue.received_date,
    project: issue.project,
    client: issue.client,
    reported_by: issue.reported_by,
    description: issue.description,
    status: issue.status,
    response_date: issue.response_date,
    response_notes: issue.response_notes,
  };
}

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Upload area for one kind of attachment (the client's issue email, or our
 * response email): existing files with previews, newly picked files waiting
 * to be saved, and a drop/paste zone — pasting a screenshot straight from the
 * clipboard (Win+Shift+S → Ctrl+V) is the quickest way to attach an email.
 */
function AttachmentField({ label, hint, issueId, existing, pending, setPending, onRemoveExisting, canRemove, onPreview }) {
  const inputRef = useRef(null);
  const zoneRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(false);

  function addFiles(list) {
    const files = [...list].map((f, i) =>
      // Clipboard screenshots arrive as "image.png" — give each a distinct, meaningful name.
      f.name === "image.png" ? new File([f], `screenshot_${Date.now()}_${i}.png`, { type: f.type }) : f
    );
    if (files.length) setPending((p) => [...p, ...files]);
  }

  return (
    <div className="mb-2">
      <label className="form-label small mb-1 fw-semibold" onClick={() => zoneRef.current?.focus()}>{label}</label>
      {/* Clicking the zone only selects it (focus) so Ctrl+V pastes into it; the
          "Choose file" button opens the file picker. */}
      <div
        ref={zoneRef}
        className={`issue-drop${dragOver ? " drag" : ""}${selected ? " selected" : ""}`}
        tabIndex={0}
        onClick={() => zoneRef.current?.focus()}
        onFocus={() => setSelected(true)}
        onBlur={() => setSelected(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onPaste={(e) => {
          const files = [...(e.clipboardData?.files || [])];
          if (files.length) {
            e.preventDefault();
            addFiles(files);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <i className={`bi ${selected ? "bi-clipboard-check" : "bi-cloud-arrow-up"}`} />
        <div className="flex-grow-1">
          {selected ? (
            <>
              <b>Selected — press Ctrl+V</b> to paste a screenshot, or drag &amp; drop files here
            </>
          ) : (
            <>
              <b>Click here</b> and press <b>Ctrl+V</b> to paste a screenshot, or drag &amp; drop files
            </>
          )}
          <div className="issue-drop-hint">{hint}</div>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary issue-drop-browse"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          <i className="bi bi-folder2-open me-1" />
          Choose file
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {(existing.length > 0 || pending.length > 0) && (
        <div className="issue-att-grid">
          {existing.map((a) => (
            <AttachmentTile
              key={a.id}
              name={a.original_name}
              type={a.file_type}
              meta={`${a.uploaded_by} · ${fmtSize(a.size)}`}
              url={issueAttachmentUrl(issueId, a.id)}
              onPreview={onPreview}
              onRemove={canRemove(a) ? () => onRemoveExisting(a) : null}
            />
          ))}
          {pending.map((f, i) => (
            <PendingTile key={`${f.name}-${i}`} file={f} onRemove={() => setPending((p) => p.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
    </div>
  );
}

const TYPE_ICON = { pdf: "bi-file-earmark-pdf-fill", email: "bi-envelope-paper-fill", image: "bi-file-earmark-image" };

export function AttachmentTile({ name, type, meta, url, onPreview, onRemove }) {
  const body =
    type === "image" ? (
      <button type="button" className="issue-att-thumb" onClick={() => onPreview({ src: url, title: name })} title="Preview">
        <img src={url} alt={name} />
      </button>
    ) : (
      <a className="issue-att-thumb issue-att-icon" href={url} target="_blank" rel="noreferrer" title={type === "email" ? "Download email" : "Open"}>
        <i className={`bi ${TYPE_ICON[type]}`} />
      </a>
    );
  return (
    <div className="issue-att">
      {body}
      <div className="issue-att-name" title={name}>{name}</div>
      {meta && <div className="issue-att-meta">{meta}</div>}
      {onRemove && (
        <button type="button" className="issue-att-remove" title="Remove file" onClick={onRemove}>
          <i className="bi bi-x" />
        </button>
      )}
    </div>
  );
}

function PendingTile({ file, onRemove }) {
  const isImage = file.type.startsWith("image/");
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!isImage) return;
    const u = URL.createObjectURL(file);
    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [file, isImage]);
  const ext = file.name.split(".").pop().toLowerCase();
  return (
    <div className="issue-att issue-att-pending">
      <div className={`issue-att-thumb${isImage ? "" : " issue-att-icon"}`}>
        {isImage ? src && <img src={src} alt={file.name} /> : <i className={`bi ${ext === "pdf" ? TYPE_ICON.pdf : TYPE_ICON.email}`} />}
      </div>
      <div className="issue-att-name" title={file.name}>{file.name}</div>
      <div className="issue-att-meta">New · not saved yet</div>
      <button type="button" className="issue-att-remove" title="Remove" onClick={onRemove}>
        <i className="bi bi-x" />
      </button>
    </div>
  );
}

/** Log a new client issue (no `issue`) or view/edit/classify an existing one. */
export default function IssueModal({ open, issue, onClose, user, projectDetails }) {
  const toast = useToast();
  const save = useSaveIssue();
  const removeAttachment = useDeleteIssueAttachment();
  const [form, setForm] = useState(emptyForm);
  const [issueFiles, setIssueFiles] = useState([]);
  const [responseFiles, setResponseFiles] = useState([]);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(issue ? fromIssue(issue) : emptyForm());
    setIssueFiles([]);
    setResponseFiles([]);
    // Re-seed only when a different issue is opened, not on every refetch of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, issue?.id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const isPrivileged = ["admin", "management"].includes(user?.role);
  const canRemove = (a) => isPrivileged || a.uploaded_by === user?.username;
  const existing = issue?.attachments || [];

  async function onRemoveExisting(a) {
    if (!confirm(`Remove "${a.original_name}"? This can't be undone.`)) return;
    try {
      await removeAttachment.mutateAsync({ id: issue.id, attachmentId: a.id });
      toast.success("File removed.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to remove file.");
    }
  }

  async function submit(e) {
    e.preventDefault();
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.append(k, v ?? "");
    for (const f of issueFiles) fd.append("issue_files", f, f.name);
    for (const f of responseFiles) fd.append("response_files", f, f.name);
    try {
      const res = await save.mutateAsync({ id: issue?.id, formData: fd });
      toast.success(res.message);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save issue.");
    }
  }

  const statusMeta = ISSUE_STATUSES.find((s) => s.value === form.status) || ISSUE_STATUSES[0];

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={issue ? `Issue #${issue.issue_number} — ${issue.title}` : "Log Client Issue"}
        maxWidth={900}
        footer={
          <>
            {issue && (
              <span className="me-auto small text-muted">
                Logged by {issue.created_by || "—"}
                {issue.updated_by && <> · last updated by {issue.updated_by}</>}
              </span>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" form="issue-form" className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-check-lg" />}{" "}
              {issue ? "Save Changes" : "Log Issue"}
            </button>
          </>
        }
      >
        <form id="issue-form" onSubmit={submit}>
          <div className="issue-section-title"><i className="bi bi-envelope-exclamation" /> Issue from client</div>
          <div className="row g-2 mb-2">
            <div className="col-md-8">
              <label className="form-label small mb-1">Subject / Issue <span className="text-danger">*</span></label>
              <input className="form-control" required value={form.title} onChange={set("title")} placeholder="e.g. Missing bolt holes on beam B12" />
            </div>
            <div className="col-md-4">
              <label className="form-label small mb-1">Email received on <span className="text-danger">*</span></label>
              <input type="date" className="form-control" required value={form.received_date} onChange={set("received_date")} />
            </div>
            <div className="col-md-4">
              <label className="form-label small mb-1">Project</label>
              <SearchableDropdown
                value={form.project}
                onChange={set("project")}
                onSelect={(name) => {
                  const client = projectDetails.find((p) => p.name === name)?.client;
                  setForm((f) => ({ ...f, project: name, client: client || f.client }));
                }}
                options={projectDetails.map((p) => p.name)}
                placeholder="Select or type a project"
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small mb-1">Client</label>
              <input className="form-control" value={form.client} onChange={set("client")} />
            </div>
            <div className="col-md-4">
              <label className="form-label small mb-1">Reported by (client contact)</label>
              <input className="form-control" value={form.reported_by} onChange={set("reported_by")} />
            </div>
            <div className="col-12">
              <label className="form-label small mb-1">Details</label>
              <textarea className="form-control" rows={2} value={form.description} onChange={set("description")} placeholder="Summary of what the client reported" />
            </div>
          </div>
          <AttachmentField
            label="Client's issue email (screenshot or the email file)"
            hint="Images, PDF, .eml or .msg — up to 25MB each"
            issueId={issue?.id}
            existing={existing.filter((a) => a.kind === "issue")}
            pending={issueFiles}
            setPending={setIssueFiles}
            onRemoveExisting={onRemoveExisting}
            canRemove={canRemove}
            onPreview={setPreview}
          />

          <div className="issue-section-title mt-3"><i className="bi bi-clipboard-check" /> Review outcome</div>
          <div className="issue-status-pick mb-2">
            {ISSUE_STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`issue-status-opt issue-st-${s.cls}${form.status === s.value ? " active" : ""}`}
                onClick={() => setForm((f) => ({ ...f, status: s.value }))}
              >
                <i className={`bi ${s.icon}`} />
                <span>
                  <b>{s.value}</b>
                  <small>{s.hint}</small>
                </span>
              </button>
            ))}
          </div>
          {(form.status !== "Under Review" || existing.some((a) => a.kind === "response")) && (
            <>
              <div className="row g-2 mb-2">
                <div className="col-md-4">
                  <label className="form-label small mb-1">Response date</label>
                  <input type="date" className="form-control" value={form.response_date || today()} onChange={set("response_date")} />
                </div>
                <div className="col-md-8">
                  <label className="form-label small mb-1">Response notes</label>
                  <textarea
                    className="form-control"
                    rows={2}
                    value={form.response_notes}
                    onChange={set("response_notes")}
                    placeholder={statusMeta.cls === "ours" ? "What went wrong and how it was fixed" : "Why it isn't our error"}
                  />
                </div>
              </div>
              <AttachmentField
                label="Our response email (screenshot or the email file)"
                hint="Images, PDF, .eml or .msg — up to 25MB each"
                issueId={issue?.id}
                existing={existing.filter((a) => a.kind === "response")}
                pending={responseFiles}
                setPending={setResponseFiles}
                onRemoveExisting={onRemoveExisting}
                canRemove={canRemove}
                onPreview={setPreview}
              />
            </>
          )}
        </form>
      </Modal>
      <ImageLightboxModal open={!!preview} src={preview?.src} title={preview?.title} onClose={() => setPreview(null)} />
    </>
  );
}
