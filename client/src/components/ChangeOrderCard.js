"use client";
import { getChangeOrderStatus } from "../lib/changeOrderStatus";

function fmtDateLong(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

/** One Change Order card — CO#/type/status/edit/delete on top, notes,
 * date/hours summary chips, then created-by along the bottom. */
export default function ChangeOrderCard({ co, canEdit, canDelete, onEdit, onDelete, showTotal = true }) {
  const status = getChangeOrderStatus(co);
  return (
    <div className="co-card">
      <div className="co-card-top">
        <div className="co-card-left">
          <span className="co-number-pill">CO{co.co_number}</span>
          <span className="co-change-type">{co.change_type}</span>
        </div>
        <div className="co-card-actions">
          <span className={`co-status-pill co-status-${status.key}`}>
            <i className={`bi ${status.icon}`} /> {status.label.toUpperCase()}
          </span>
          {canEdit && (
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onEdit(co)}>
              <i className="bi bi-pencil" /> Edit
            </button>
          )}
          {canDelete && (
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => onDelete(co)}>
              <i className="bi bi-trash" /> Delete
            </button>
          )}
        </div>
      </div>

      {co.notes && <div className="co-notes">{co.notes}</div>}

      <div className="co-chip-row">
        {co.team && (
          <span className="co-chip co-chip-muted">
            <i className="bi bi-people" /> <span className="co-chip-label">Team</span> {co.team}
          </span>
        )}
        <span className="co-chip">
          <i className="bi bi-calendar3" /> <span className="co-chip-label">Date</span> {fmtDateLong(co.date)}
        </span>
        <span className="co-chip">
          <i className="bi bi-clock" /> <span className="co-chip-label">Hours</span> {Number(co.hours ?? 0).toFixed(2)}
        </span>
        {showTotal && (
          <span className="co-chip">
            <i className="bi bi-currency-dollar" /> <span className="co-chip-label">Total</span> {co.currency || "USD"} {Number(co.total ?? 0).toFixed(2)}
          </span>
        )}
      </div>

      <div className="co-card-bottom">
        <div className="co-created-by">
          <i className="bi bi-person" /> {co.created_by || "—"}
        </div>
      </div>
    </div>
  );
}
