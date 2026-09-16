"use client";

const APPROVAL_ICON = {
  Pending: "bi-hourglass-split",
  Approved: "bi-check-circle-fill",
  Rejected: "bi-x-circle-fill",
};

function fmtDateLong(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

/** One Change Order card — CO#/type/approval/edit/delete on top, notes,
 * date/hours/billed summary chips, then created-by + live Approve/Reject +
 * Billed toggle controls along the bottom. */
export default function ChangeOrderCard({ co, canEdit, canDelete, onEdit, onDelete, onSetApproval, onToggleBilled }) {
  return (
    <div className="co-card">
      <div className="co-card-top">
        <div className="co-card-left">
          <span className="co-number-pill">CO#{co.co_number}</span>
          <span className="co-change-type">{co.change_type}</span>
        </div>
        <div className="co-card-actions">
          <span className={`co-status-pill co-status-${co.approval.toLowerCase()}`}>
            <i className={`bi ${APPROVAL_ICON[co.approval] || "bi-hourglass-split"}`} /> {co.approval.toUpperCase()}
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
        <span className="co-chip co-chip-muted">
          <i className="bi bi-currency-dollar" /> <span className="co-chip-label">Billed</span> {co.billed ? "Yes" : "No"}
        </span>
      </div>

      <div className="co-card-bottom">
        <div className="co-created-by">
          <i className="bi bi-person" /> {co.created_by || "—"}
        </div>
        <div className="co-approval-controls">
          {canEdit ? (
            <>
              {/* Once a decision is made, the Approve/Reject buttons served their
                  purpose — the status pill up top already shows the outcome.
                  Changing your mind from here on happens via Edit. */}
              {co.approval === "Pending" && (
                <>
                  <span className="co-approval-label">Approval:</span>
                  <button type="button" className="co-approve-btn" onClick={() => onSetApproval(co, "Approved")}>
                    <i className="bi bi-check-lg" /> Approve
                  </button>
                  <button type="button" className="co-reject-btn" onClick={() => onSetApproval(co, "Rejected")}>
                    <i className="bi bi-x-lg" /> Reject
                  </button>
                </>
              )}
              <span className="co-billed-label ms-2">Billed</span>
              <button
                type="button"
                role="switch"
                aria-checked={co.billed}
                className={`switch-toggle${co.billed ? " on" : ""}`}
                onClick={() => onToggleBilled(co, !co.billed)}
              >
                <span className="switch-thumb" />
              </button>
              <span className="co-billed-status-text">{co.billed ? "Billed" : "Not billed"}</span>
            </>
          ) : (
            <span className="co-billed-status-text">{co.billed ? "Billed" : "Not billed"}</span>
          )}
        </div>
      </div>
    </div>
  );
}
