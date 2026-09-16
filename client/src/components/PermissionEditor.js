"use client";
import { useEffect, useState } from "react";
import SearchableDropdown from "./SearchableDropdown";
import { useToast } from "../lib/ToastContext";
import { ApiError } from "../lib/api";

/** Same members regardless of order — chip order can shift (add appends,
 * remove filters) without that alone counting as a real change. */
function sameMembers(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * One "who can do X" section for the Settings page — a searchable add box,
 * removable chips, and its own Save button, saved independently of the
 * other sections. Used for Invoice Released editors, record updaters, and
 * record deleters (see app/settings/page.js) — admins are always allowed
 * regardless of this list, so they're filtered out of `users` before it
 * gets here (nothing useful for them to add themselves to).
 *
 * `color` picks a dp-icon / dp-header color variant (same palette as the
 * submission detail page's panels — globals.css) so each section reads as
 * its own distinct card instead of three identical grey ones.
 */
export default function PermissionEditor({ icon, color = "blue", title, description, emptyNote, users, initial, onSave }) {
  const toast = useToast();
  const [selected, setSelected] = useState(initial || []);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(initial || []);
  }, [initial]);

  const isDirty = !sameMembers(selected, initial || []);

  const roleByUsername = Object.fromEntries(users.map((u) => [u.username, u.role]));
  const availableUsernames = users.map((u) => u.username).filter((u) => !selected.includes(u));

  function addUser(u) {
    if (!u || !roleByUsername[u] || selected.includes(u)) return;
    setSelected((prev) => [...prev, u]);
  }
  function removeUser(u) {
    setSelected((prev) => prev.filter((x) => x !== u));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(selected);
      toast.success("Settings saved.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="detail-panel settings-permission-card">
      <div className={`detail-panel-header dp-header-${color}`}>
        <div className="dp-header-row">
          <div className="dp-header-left">
            <span className={`dp-icon dp-icon-${color}`}>
              <i className={`bi ${icon}`} />
            </span>
            <div className="dp-header-title">{title}</div>
          </div>
        </div>
      </div>

      <div className="detail-panel-body d-flex flex-column flex-grow-1">
        <p className="text-muted small">{description}</p>

        <label className="form-label small mb-1">Add a user</label>
        <SearchableDropdown
          value={search}
          onChange={setSearch}
          onSelect={(u) => {
            addUser(u);
            setSearch("");
          }}
          options={availableUsernames}
          placeholder="Search a user by name…"
          renderOption={(u) => (
            <div className="d-flex align-items-center gap-2">
              <i className="bi bi-person-fill" /> {u} <span className="text-muted small">({roleByUsername[u]})</span>
            </div>
          )}
        />

        <div className="d-flex flex-wrap gap-2 mt-3 mb-1 flex-grow-1">
          {selected.length > 0 ? (
            selected.map((u) => (
              <span key={u} className="settings-user-chip">
                <i className="bi bi-person-fill" />
                {u} <span className="settings-user-chip-role">({roleByUsername[u] || "removed user"})</span>
                <button type="button" className="settings-chip-remove" aria-label={`Remove ${u}`} onClick={() => removeUser(u)}>
                  <i className="bi bi-x" />
                </button>
              </span>
            ))
          ) : (
            <span className="text-muted small">{emptyNote}</span>
          )}
        </div>

        <div className="d-flex gap-2 align-items-center mt-3">
          {isDirty && (
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              <i className="bi bi-check2" /> Save
            </button>
          )}
          <span className="text-muted small">{selected.length} selected</span>
        </div>
      </div>
    </div>
  );
}
