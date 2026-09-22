"use client";
import { getChangeOrderStatus } from "../lib/changeOrderStatus";
import StatusBadge from "./StatusBadge";

function fmtDateLong(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

/** One Change Order card — CO#/type on top, then status (left) / edit+delete
 * (right) on their own row, notes, linked-submissions chips, date/hours
 * summary chips, then created-by along the bottom. */
export default function ChangeOrderCard({ co, canEdit, canDelete, onEdit, onDelete, showTotal = true, submissionOptions = [] }) {
  const status = getChangeOrderStatus(co);
  const linkedSubmissions = (co.linked_submission_ids || []).map(
    (id) => submissionOptions.find((s) => String(s.id) === String(id)) || { id, submission_name: "" }
  );
  return (
    <div className="co-card">
      <div className="co-card-top">
        <div className="co-card-left">
          <span className="co-number-pill">CO{co.co_number}</span>
          <span className="co-change-type">{co.change_type}</span>
        </div>
      </div>

      <div className="co-card-status-row">
        <span className={`co-status-pill co-status-${status.key}`}>
          <i className={`bi ${status.icon}`} /> {status.label.toUpperCase()}
        </span>
        <div className="co-card-actions">
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

      {linkedSubmissions.length > 0 && (
        <div className="co-linked-section">
          <div className="co-linked-section-label">
            <i className="bi bi-link-45deg" /> Linked Submissions ({linkedSubmissions.length})
          </div>
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
                  {s.percentage != null && <span className="submission-row-pct">{s.percentage}%</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
