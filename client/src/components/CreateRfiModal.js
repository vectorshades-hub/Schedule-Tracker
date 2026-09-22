"use client";
import { useEffect, useRef, useState } from "react";
import StatusBadge from "./StatusBadge";
import { fmtDateLong } from "../lib/projectLifecycle";

const RFI_TYPES = ["RFI", "Clarification", "BFA Clarification", "Field Verification", "GC to Verify", "Other"];

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function emptyForm() {
  const today = todayISO();
  return {
    type: "RFI",
    title: "",
    description: "",
    date: today,
    expected_response_date: addDaysISO(today, 2), // a 2-day turnaround is just a starting default, freely editable
    actual_return_date: "",
    linked_submission_ids: [],
  };
}

/** Matches the reference design: a plain white card (not the app's usual
 * navy-header Modal) with an icon+title+subtitle header — same pattern as
 * CreateChangeOrderModal.js. Doubles as the Edit modal via `initial`. */
export default function CreateRfiModal({ open, onClose, onSubmit, submitting, initial, submissionOptions = [] }) {
  const [form, setForm] = useState(emptyForm);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const linkWrapRef = useRef(null);
  const isEdit = !!initial;

  useEffect(() => {
    if (!open) return;
    setForm(
      initial
        ? {
            type: initial.type || "RFI",
            title: initial.title || "",
            description: initial.description || "",
            date: initial.date || todayISO(),
            expected_response_date: initial.expected_response_date || todayISO(),
            actual_return_date: initial.actual_return_date || "",
            linked_submission_ids: (initial.linked_submission_ids || []).map(String),
          }
        : emptyForm()
    );
    setLinkQuery("");
    setLinkOpen(false);
  }, [open, initial]);

  useEffect(() => {
    function onDocClick(e) {
      if (linkWrapRef.current && !linkWrapRef.current.contains(e.target)) setLinkOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  const linkedIds = form.linked_submission_ids || [];
  const linkedSubmissions = linkedIds.map((id) => submissionOptions.find((s) => String(s.id) === String(id)) || { id, submission_name: "", percentage: null, status: "", tag: "" });
  const linkQueryLower = linkQuery.trim().toLowerCase();
  const linkMatches = submissionOptions
    .filter((s) => !linkedIds.includes(String(s.id)))
    .filter((s) => !linkQueryLower || String(s.id).toLowerCase().includes(linkQueryLower) || (s.submission_name || "").toLowerCase().includes(linkQueryLower))
    .slice(0, 8);

  function addLink(id) {
    setForm((f) => ({ ...f, linked_submission_ids: [...(f.linked_submission_ids || []), String(id)] }));
    setLinkQuery("");
    setLinkOpen(false);
  }

  function removeLink(id) {
    setForm((f) => ({ ...f, linked_submission_ids: (f.linked_submission_ids || []).filter((x) => String(x) !== String(id)) }));
  }

  return (
    <div className="st-modal-backdrop co-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal co-modal" style={{ maxWidth: 720 }}>
        <div className="co-modal-header">
          <div className="co-modal-header-icon co-modal-header-icon-amber">
            <i className="bi bi-journal-bookmark-fill" />
          </div>
          <div>
            <div className="co-modal-title">{isEdit ? "Edit RFI / Clarification" : "Create RFI / Clarification"}</div>
            <div className="co-modal-subtitle">{isEdit ? initial.title : "RFI / Clarification Request"}</div>
          </div>
          <button type="button" className="co-modal-close" onClick={onClose} aria-label="Close">
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="st-modal-body">
            <div className="row g-3">
              <div className="col-6">
                <label className="form-label small fw-bold">Type</label>
                <select
                  className="form-select"
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                >
                  {RFI_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-6">
                <label className="form-label small fw-bold">
                  Title <span className="text-danger">*</span>
                </label>
                <input
                  className="form-control"
                  placeholder="Brief subject"
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="col-12">
                <label className="form-label small fw-bold">Description</label>
                <textarea
                  className="form-control"
                  rows={3}
                  placeholder="Describe the information needed…"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="col-12">
                <label className="form-label small fw-bold co-linked-label">
                  Linked Submissions <span className="co-optional-label">optional</span>
                  {linkedSubmissions.length > 0 && (
                    <span className="co-linked-count">{linkedSubmissions.length} linked</span>
                  )}
                </label>
                <div className="sd-wrap co-link-search" ref={linkWrapRef}>
                  <i className="bi bi-search co-link-search-icon" />
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search by submission # or name…"
                    value={linkQuery}
                    onChange={(e) => {
                      setLinkQuery(e.target.value);
                      setLinkOpen(true);
                    }}
                    onFocus={() => setLinkOpen(true)}
                  />
                  {linkOpen && linkMatches.length > 0 && (
                    <div className="sd-list">
                      {linkMatches.map((s) => (
                        <div
                          key={s.id}
                          className="sd-item co-link-sd-item"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            addLink(s.id);
                          }}
                        >
                          <span className="co-link-sd-main">
                            <span className="co-link-sd-id">#{s.id}</span>
                            <span>{s.submission_name || "Untitled"}</span>
                          </span>
                          {s.status ? <StatusBadge status={s.status} tag={s.tag} /> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {linkedSubmissions.length > 0 && (
                  <div className="co-linked-submissions">
                    {linkedSubmissions.map((s) => (
                      <div className="co-linked-row" key={s.id}>
                        <div className="co-linked-row-icon">
                          <i className="bi bi-link-45deg" />
                        </div>
                        <span className="co-linked-row-name" title={s.submission_name || "Unknown submission"}>
                          <span className="co-linked-row-id">#{s.id}</span> {s.submission_name || "Unknown submission"}
                        </span>
                        <div className="co-linked-row-meta">
                          {s.status ? <StatusBadge status={s.status} tag={s.tag} /> : null}
                          <span className="submission-row-pct">{s.percentage ?? 0}%</span>
                          <span className="submission-row-date">
                            <i className="bi bi-calendar-event" /> {fmtDateLong(s.due_date_raw) || "No due date"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="co-link-remove"
                          onClick={() => removeLink(s.id)}
                          aria-label={`Unlink submission #${s.id}`}
                        >
                          <i className="bi bi-x-lg" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="col-6">
                <label className="form-label small fw-bold">
                  Date <span className="text-danger">*</span>
                </label>
                <input
                  type="date"
                  className="form-control"
                  required
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="col-6">
                <label className="form-label small fw-bold">
                  Expected Response Date <span className="text-danger">*</span>
                </label>
                <input
                  type="date"
                  className="form-control"
                  required
                  value={form.expected_response_date}
                  onChange={(e) => setForm((f) => ({ ...f, expected_response_date: e.target.value }))}
                />
              </div>
              <div className="col-12">
                <label className="form-label small fw-bold">
                  Actual Return Date <span className="co-optional-label">(optional)</span>
                </label>
                <input
                  type="date"
                  className="form-control"
                  value={form.actual_return_date}
                  onChange={(e) => setForm((f) => ({ ...f, actual_return_date: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <div className="st-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-rfi-orange" disabled={submitting}>
              {isEdit ? "Save Changes" : "Create RFI"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
