"use client";

/**
 * Reused across 3 flows (upload, edit-row, edit-project) — matches the original's
 * `buildAccessPanel()`. Checking a management user auto-cascades their mapped
 * team leads via `mgmtTlMap`.
 */
export default function AccessChipsPanel({ uploaderName, users, checked, onChange, mgmtTlMap, defaultTl }) {
  function toggle(u) {
    if (checked.includes(u)) {
      onChange(checked.filter((x) => x !== u));
    } else {
      const cascade = mgmtTlMap?.[u] || [];
      onChange([...new Set([...checked, u, ...cascade])]);
    }
  }
  return (
    <div className="d-flex flex-wrap gap-2">
      <span className="badge bg-dark">{uploaderName} (uploader)</span>
      {users.map((u) => (
        <label key={u} className="badge bg-light text-dark border" style={{ cursor: "pointer" }}>
          <input type="checkbox" className="form-check-input me-1" checked={checked.includes(u)} onChange={() => toggle(u)} />
          {u}
          {defaultTl === u && <span className="ms-1 badge bg-success">Default TL</span>}
        </label>
      ))}
    </div>
  );
}
