"use client";
import { useEffect, useState } from "react";
import { fmtDateLong, parseDate } from "../lib/projectLifecycle";

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days from the submission's due date to today (0 if not yet due) — same as routes/bfas.js daysFromDue. */
function daysFromDue(dueRaw) {
  const due = parseDate(dueRaw);
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - d) / 86400000));
}

function emptyForm() {
  return { tr_number: "", submission_id: "", submitted_date: todayISO(), description: "", days_awaited_override: "", status: "No" };
}

/** Add/Edit a BFA / IFA tracking entry — same white-header modal pattern as
 * CreateRfiModal. TR# is typed in; the submission is picked from the project's
 * completed submissions; Days awaited fills in from that submission's due date
 * and can be typed over. Status Yes/No (default No) — only "No" entries go on
 * the Weekly Status report. */
export default function CreateBfaModal({ open, onClose, onSubmit, submitting, initial, submissionOptions = [] }) {
  const [form, setForm] = useState(emptyForm);
  const isEdit = !!initial;

  useEffect(() => {
    if (!open) return;
    setForm(
      initial
        ? {
            tr_number: initial.tr_number || "",
            status: initial.status === "Yes" ? "Yes" : "No",
            submission_id: String(initial.submission_id),
            submitted_date: initial.submitted_date || todayISO(),
            description: initial.description || "",
            days_awaited_override: initial.days_awaited_override ?? "",
          }
        : emptyForm()
    );
  }, [open, initial]);

  if (!open) return null;

  const completed = submissionOptions.filter((s) => (s.tag || "").startsWith("completed"));
  // Keep an edited entry's submission selectable even if it's since been un-completed.
  const options =
    isEdit && !completed.some((s) => String(s.id) === String(initial.submission_id))
      ? [...completed, { id: initial.submission_id, submission_name: initial.submission_name, due_date_raw: initial.submission_due_date }]
      : completed;
  const selected = options.find((s) => String(s.id) === form.submission_id);
  const autoDays = selected ? daysFromDue(selected.due_date_raw) : null;
  const overridden = String(form.days_awaited_override).trim() !== "";

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <div className="st-modal-backdrop co-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal co-modal" style={{ maxWidth: 720 }}>
        <div className="co-modal-header">
          <div className="co-modal-header-icon co-modal-header-icon-amber">
            <i className="bi bi-send-check-fill" />
          </div>
          <div>
            <div className="co-modal-title">{isEdit ? "Edit BFA" : "Add BFA"}</div>
            <div className="co-modal-subtitle">Transmittal awaiting return from the customer</div>
          </div>
          <button type="button" className="co-modal-close" onClick={onClose} aria-label="Close">
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="st-modal-body">
            <div className="row g-3">
              <div className="col-5">
                <label className="form-label small fw-bold">
                  TR# <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="form-control"
                  required
                  placeholder="e.g. 105"
                  value={form.tr_number}
                  onChange={(e) => setForm((f) => ({ ...f, tr_number: e.target.value }))}
                />
              </div>
              <div className="col-7">
                <label className="form-label small fw-bold">
                  Submission <span className="text-danger">*</span>
                </label>
                <select
                  className="form-select"
                  required
                  value={form.submission_id}
                  onChange={(e) => setForm((f) => ({ ...f, submission_id: e.target.value }))}
                >
                  <option value="">{options.length ? "Select a completed submission…" : "No completed submissions yet"}</option>
                  {options.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.submission_name || `#${s.id}`}
                    </option>
                  ))}
                </select>
                {selected && (
                  <div className="form-text">
                    <i className="bi bi-calendar-event" /> Due {fmtDateLong(selected.due_date_raw) || "— no due date"}
                  </div>
                )}
              </div>
              <div className="col-5">
                <label className="form-label small fw-bold">
                  Submitted date <span className="text-danger">*</span>
                </label>
                <input
                  type="date"
                  className="form-control"
                  required
                  value={form.submitted_date}
                  onChange={(e) => setForm((f) => ({ ...f, submitted_date: e.target.value }))}
                />
              </div>
              <div className="col-12">
                <label className="form-label small fw-bold">Description</label>
                <textarea
                  className="form-control"
                  rows={3}
                  placeholder="What was sent / what's awaited…"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="col-5">
                <label className="form-label small fw-bold">Days awaited</label>
                <div className="input-group">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="form-control"
                    placeholder={autoDays === null ? "—" : String(autoDays)}
                    value={form.days_awaited_override}
                    onChange={(e) => setForm((f) => ({ ...f, days_awaited_override: e.target.value }))}
                  />
                  {overridden && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      title="Go back to the automatic count"
                      onClick={() => setForm((f) => ({ ...f, days_awaited_override: "" }))}
                    >
                      <i className="bi bi-arrow-counterclockwise" />
                    </button>
                  )}
                </div>
                <div className="form-text">
                  {overridden
                    ? "Set manually — stays fixed until reset."
                    : autoDays === null
                    ? "Auto: submission due date to today."
                    : `Auto: ${autoDays} day${autoDays === 1 ? "" : "s"} since the submission's due date. Type to override.`}
                </div>
              </div>
              <div className="col-4">
                <label className="form-label small fw-bold" htmlFor="bfa-status">Status</label>
                <select
                  id="bfa-status"
                  className="form-select"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
                <div className="form-text">Only "No" entries appear on the Weekly Status report.</div>
              </div>
            </div>
          </div>
          <div className="st-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-rfi-orange" disabled={submitting}>
              {isEdit ? "Save Changes" : "Add BFA"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
