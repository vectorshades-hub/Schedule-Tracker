"use client";
import { useEffect, useState } from "react";

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
  };
}

/** Matches the reference design: a plain white card (not the app's usual
 * navy-header Modal) with an icon+title+subtitle header — same pattern as
 * CreateChangeOrderModal.js. Doubles as the Edit modal via `initial`. */
export default function CreateRfiModal({ open, onClose, onSubmit, submitting, initial }) {
  const [form, setForm] = useState(emptyForm);
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
          }
        : emptyForm()
    );
  }, [open, initial]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <div className="st-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal co-modal" style={{ maxWidth: 560 }}>
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
