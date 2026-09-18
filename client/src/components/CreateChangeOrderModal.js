"use client";
import { useEffect, useState } from "react";
import SearchableDropdown from "./SearchableDropdown";

const CHANGE_TYPES = ["Revision", "Re-approval", "Scope Addition", "Scope Reduction", "Design Change", "Material Substitution", "Timeline Extension", "Budget Adjustment", "Client Request", "RFI Response", "Drawing Update", "Specification Change", "Site Condition"];
const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD"];

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const EMPTY_FORM = { co_number: "", team: "", date: todayISO(), change_type: "", notes: "", hours: "", approval: "Pending", billed: false, currency: "USD", amount: "" };

/** Matches the reference design: a plain white card (not the app's usual
 * navy-header Modal) with an icon+title+subtitle header. Self-contained
 * (same backdrop/overlay classes as Modal.js) rather than extending the
 * shared component, since its header shape is a one-off.
 *
 * Doubles as the Edit modal — pass `initial` (a change_orders row) to
 * pre-fill the form and switch the header/submit copy; omit it to create. */
export default function CreateChangeOrderModal({ open, onClose, onSubmit, submitting, initial, teamOptions = [], defaultTeam = "" }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const isEdit = !!initial;

  useEffect(() => {
    if (!open) return;
    setForm(
      initial
        ? {
            co_number: initial.co_number || "",
            team: initial.team || "",
            date: initial.date || todayISO(),
            change_type: initial.change_type || "",
            notes: initial.notes || "",
            hours: initial.hours || initial.hours === 0 ? String(initial.hours) : "",
            approval: initial.approval || "Pending",
            billed: !!initial.billed,
            currency: initial.currency || "USD",
            amount: initial.amount || initial.amount === 0 ? String(initial.amount) : "",
          }
        : { ...EMPTY_FORM, team: defaultTeam }
    );
  }, [open, initial, defaultTeam]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <div className="st-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal co-modal" style={{ maxWidth: 560 }}>
        <div className="co-modal-header">
          <div className="co-modal-header-icon">
            <i className="bi bi-currency-dollar" />
          </div>
          <div>
            <div className="co-modal-title">{isEdit ? "Edit Change Order" : "Create Change Order"}</div>
            <div className="co-modal-subtitle">
              {isEdit ? `Update CO${initial.co_number}` : "Add a new CO to this project"}
            </div>
          </div>
          <button type="button" className="co-modal-close" onClick={onClose} aria-label="Close">
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="st-modal-body">
            <div className="row g-3">
              <div className="col-4">
                <label className="form-label small fw-bold">
                  CO # <span className="text-danger">*</span>
                </label>
                <input
                  className="form-control"
                  placeholder="e.g. 001"
                  required
                  value={form.co_number}
                  onChange={(e) => setForm((f) => ({ ...f, co_number: e.target.value }))}
                />
              </div>
              <div className="col-4">
                <label className="form-label small fw-bold">
                  Team <span className="text-danger">*</span>
                </label>
                <SearchableDropdown
                  value={form.team}
                  onChange={(v) => setForm((f) => ({ ...f, team: v }))}
                  options={teamOptions}
                  placeholder="Select a team"
                  required
                />
              </div>
              <div className="col-4">
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
              <div className="col-12">
                <label className="form-label small fw-bold">
                  Change <span className="text-danger">*</span>
                </label>
                <SearchableDropdown
                  value={form.change_type}
                  onChange={(v) => setForm((f) => ({ ...f, change_type: v }))}
                  options={CHANGE_TYPES}
                  placeholder="Select or type a change type"
                  required
                />
              </div>
              <div className="col-12">
                <label className="form-label small fw-bold">Notes</label>
                <textarea
                  className="form-control"
                  rows={3}
                  placeholder="Additional details…"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <div className="col-4">
                <label className="form-label small fw-bold">Hours</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  className="form-control"
                  placeholder="0.0"
                  value={form.hours}
                  onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                />
              </div>
              <div className="col-4">
                <label className="form-label small fw-bold">Currency</label>
                <select
                  className="form-select"
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-4">
                <label className="form-label small fw-bold">Amount (per hour)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="form-control"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="col-4">
                <label className="form-label small fw-bold d-block">Total</label>
                <input
                  type="text"
                  className="form-control"
                  disabled
                  value={`${form.currency} ${((Number(form.hours) || 0) * (Number(form.amount) || 0)).toFixed(2)}`}
                />
              </div>
            </div>
          </div>
          <div className="st-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-success" disabled={submitting}>
              {isEdit ? "Save Changes" : "Create CO"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
