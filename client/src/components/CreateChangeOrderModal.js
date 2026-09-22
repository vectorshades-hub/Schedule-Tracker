"use client";
import { useEffect, useRef, useState } from "react";
import SearchableDropdown from "./SearchableDropdown";
import StatusBadge from "./StatusBadge";
import { fmtDateLong } from "../lib/projectLifecycle";

const CHANGE_TYPES = ["Revision", "Re-approval", "Scope Addition", "Scope Reduction", "Design Change", "Material Substitution", "Timeline Extension", "Budget Adjustment", "Client Request", "RFI Response", "Drawing Update", "Specification Change", "Site Condition"];
const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD"];

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const EMPTY_FORM = { co_number: "", team: "", date: todayISO(), change_type: "", notes: "", hours: "", linked_submission_ids: [], approval: "Pending", billed: false, currency: "USD", amount: "" };

/** Matches the reference design: a plain white card (not the app's usual
 * navy-header Modal) with an icon+title+subtitle header. Self-contained
 * (same backdrop/overlay classes as Modal.js) rather than extending the
 * shared component, since its header shape is a one-off.
 *
 * Doubles as the Edit modal — pass `initial` (a change_orders row) to
 * pre-fill the form and switch the header/submit copy; omit it to create. */
export default function CreateChangeOrderModal({ open, onClose, onSubmit, submitting, initial, teamOptions = [], defaultTeam = "", submissionOptions = [] }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const linkWrapRef = useRef(null);
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
            linked_submission_ids: (initial.linked_submission_ids || []).map(String),
            approval: initial.approval || "Pending",
            billed: !!initial.billed,
            currency: initial.currency || "USD",
            amount: initial.amount || initial.amount === 0 ? String(initial.amount) : "",
          }
        : { ...EMPTY_FORM, team: defaultTeam }
    );
    setLinkQuery("");
    setLinkOpen(false);
  }, [open, initial, defaultTeam]);

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
              <div className="col-3">
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
              <div className="col-3">
                <label className="form-label small fw-bold">Currency</label>
                <select
                  className="form-select"
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-3">
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
              <div className="col-3">
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
