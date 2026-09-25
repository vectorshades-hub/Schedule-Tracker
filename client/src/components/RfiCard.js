"use client";

const STATUS_ICON = {
  Pending: "bi-hourglass-split",
  Overdue: "bi-exclamation-triangle-fill",
  Returned: "bi-check-circle-fill",
};

function rfiProgressPct(rfi) {
  const questions = rfi.questions || [];
  if (!questions.length) return 0;
  const received = questions.filter((q) => q.response_received_date).length;
  return Math.round((received / questions.length) * 100);
}

/** One RFI/Clarification row — compact and scannable (Type, Title, Status,
 * Progress %) so a whole project's RFI list reads at a glance. Click
 * anywhere on the row (outside Edit/Delete) to call `onView`, which opens
 * RfiDetailsModal — that modal is rendered by the parent (SubmissionOverview),
 * not here, because it must sit outside .detail-panel (see the comment next
 * to its JSX for why nesting it inside this row's panel breaks position:fixed). */
export default function RfiCard({ rfi, canEdit, canDelete, onEdit, onDelete, onView, submissionOptions = [] }) {
  const pct = rfiProgressPct(rfi);
  const statusKey = rfi.status.toLowerCase();

  function handleRowKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onView(rfi);
    }
  }

  return (
    <div
      className={`rfi-row rfi-row-${statusKey}`}
      role="button"
      tabIndex={0}
      onClick={() => onView(rfi)}
      onKeyDown={handleRowKeyDown}
    >
      <div className="rfi-row-content">
        <div className="rfi-row-top">
          <span className="rfi-type-pill">{rfi.type}</span>
          <span className="rfi-row-title">{rfi.title}</span>
        </div>

        <div className="rfi-row-bottom">
          <span className={`co-status-pill rfi-status-${statusKey}`}>
            <i className={`bi ${STATUS_ICON[rfi.status] || "bi-hourglass-split"}`} /> {rfi.status.toUpperCase()}
          </span>

          <div className="rfi-row-progress">
            <div className="rfi-row-progress-track">
              <div
                className="rfi-row-progress-bar"
                style={{ width: `${pct}%`, background: pct === 100 ? "#22c55e" : "#f0b429" }}
              />
            </div>
            <span className="rfi-row-progress-pct">{pct}%</span>
          </div>

          <div className="rfi-row-actions" onClick={(e) => e.stopPropagation()}>
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
      </div>

      <i className="bi bi-chevron-right rfi-row-chevron" aria-hidden="true" />
    </div>
  );
}
