"use client";

const STATUS_ICON = {
  Pending: "bi-hourglass-split",
  Overdue: "bi-exclamation-triangle-fill",
  Returned: "bi-check-circle-fill",
};

function fmtDateLong(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

/** One RFI/Clarification card — type/title/status/edit/delete on top,
 * description, date chips, then created-by + a reversible "Response
 * Received" toggle (unlike Change Order's one-shot Approve/Reject, this can
 * be flipped back off — see rfis.js's POST /:id/response). */
export default function RfiCard({ rfi, canEdit, canDelete, onEdit, onDelete, onSetResponseReceived }) {
  const received = rfi.status === "Returned";
  return (
    <div className="co-card rfi-card">
      <div className="co-card-top">
        <div className="co-card-left">
          <span className="rfi-type-pill">{rfi.type}</span>
          <span className="co-change-type">{rfi.title}</span>
        </div>
        <div className="co-card-actions">
          <span className={`co-status-pill rfi-status-${rfi.status.toLowerCase()}`}>
            <i className={`bi ${STATUS_ICON[rfi.status] || "bi-hourglass-split"}`} /> {rfi.status.toUpperCase()}
          </span>
          {canEdit && (
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onEdit(rfi)}>
              <i className="bi bi-pencil" /> Edit
            </button>
          )}
          {canDelete && (
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => onDelete(rfi)}>
              <i className="bi bi-trash" /> Delete
            </button>
          )}
        </div>
      </div>

      {rfi.description && <div className="co-notes">{rfi.description}</div>}

      <div className="co-chip-row">
        <span className="co-chip">
          <i className="bi bi-calendar3" /> <span className="co-chip-label">RFI Date</span> {fmtDateLong(rfi.date)}
        </span>
        <span className="co-chip co-chip-amber">
          <i className="bi bi-clock" /> <span className="co-chip-label">Expected</span>{" "}
          {fmtDateLong(rfi.expected_response_date)}
        </span>
        {rfi.actual_return_date && (
          <span className="co-chip co-chip-green">
            <i className="bi bi-calendar-check" /> <span className="co-chip-label">Returned</span>{" "}
            {fmtDateLong(rfi.actual_return_date)}
          </span>
        )}
      </div>

      <div className="co-card-bottom">
        <div className="co-created-by">
          <i className="bi bi-person" /> {rfi.created_by || "—"}
        </div>
        {canEdit ? (
          <div className="co-approval-controls">
            <span className="co-billed-label">Response Received</span>
            <button
              type="button"
              role="switch"
              aria-checked={received}
              className={`switch-toggle${received ? " on" : ""}`}
              onClick={() => onSetResponseReceived(rfi, !received)}
            >
              <span className="switch-thumb" />
            </button>
            <span className="co-billed-status-text">{received ? "Received" : "Not received"}</span>
          </div>
        ) : (
          <span className="co-billed-status-text">{received ? "Received" : "Not received"}</span>
        )}
      </div>
    </div>
  );
}
