"use client";
import { useEffect, useState } from "react";

/** Add/Edit Client — plain white-header modal, same pattern as CreateRfiModal.
 * Doubles as the Edit modal via `initial` (the client's current name). */
export default function ClientModal({ open, onClose, onSubmit, submitting, initial }) {
  const [name, setName] = useState("");
  const isEdit = !!initial;

  useEffect(() => {
    if (open) setName(initial?.name || "");
  }, [open, initial]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim());
  }

  return (
    <div className="st-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal co-modal" style={{ maxWidth: 440 }}>
        <div className="co-modal-header">
          <div className="co-modal-header-icon co-modal-header-icon-blue">
            <i className="bi bi-building" />
          </div>
          <div>
            <div className="co-modal-title">{isEdit ? "Edit Client" : "Add New Client"}</div>
            <div className="co-modal-subtitle">{isEdit ? initial.name : "Clients group the projects they own"}</div>
          </div>
          <button type="button" className="co-modal-close" onClick={onClose} aria-label="Close">
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="st-modal-body">
            <label className="form-label small fw-bold">
              Client Name <span className="text-danger">*</span>
            </label>
            <input
              className="form-control"
              placeholder="Type a client name…"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="st-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !name.trim()}>
              {isEdit ? "Save Changes" : "Add Client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
