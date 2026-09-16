"use client";
import { useEffect, useState } from "react";
import SearchableDropdown from "./SearchableDropdown";

/**
 * Add/Edit Project — same modal pattern as ClientModal/CreateRfiModal. The
 * client field is a `strict` SearchableDropdown: it can only ever hold one
 * of `clients` (an existing client's exact name), never arbitrary typed
 * text, so a project can't end up pointing at a client that doesn't exist.
 * `initial` (edit mode) is the project's current { name, client }. In add
 * mode, `presetClient` pre-fills the client field — used by each client
 * card's own "+ Add project" shortcut so adding one doesn't require
 * re-picking the client from the full list.
 */
export default function ProjectModal({ open, onClose, onSubmit, submitting, initial, presetClient, clients }) {
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const isEdit = !!initial;

  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setClient(initial?.client || presetClient || "");
    }
  }, [open, initial, presetClient]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !client.trim()) return;
    onSubmit({ name: name.trim(), client: client.trim() });
  }

  return (
    <div className="st-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal co-modal" style={{ maxWidth: 440 }}>
        <div className="co-modal-header">
          <div className="co-modal-header-icon">
            <i className="bi bi-folder-fill" />
          </div>
          <div>
            <div className="co-modal-title">{isEdit ? "Edit Project" : "Add New Project"}</div>
            <div className="co-modal-subtitle">{isEdit ? initial.name : presetClient ? `Adding to ${presetClient}` : "Every project belongs to a client"}</div>
          </div>
          <button type="button" className="co-modal-close" onClick={onClose} aria-label="Close">
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="st-modal-body">
            <div className="row g-3">
              <div className="col-12">
                <label className="form-label small fw-bold">
                  Project Name <span className="text-danger">*</span>
                </label>
                <input
                  className="form-control"
                  placeholder="Type a project name…"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="col-12">
                <label className="form-label small fw-bold">
                  Client <span className="text-danger">*</span>
                </label>
                <SearchableDropdown
                  value={client}
                  onChange={setClient}
                  options={clients}
                  placeholder={clients.length ? "Search and select a client…" : "Add a client first…"}
                  strict
                  required
                />
                {!clients.length && <div className="text-muted small mt-1">No clients yet — add one before creating a project.</div>}
              </div>
            </div>
          </div>
          <div className="st-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !name.trim() || !client.trim()}>
              {isEdit ? "Save Changes" : "Add Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
