"use client";
import { getChangeOrderStatus } from "../lib/changeOrderStatus";
import StatusBadge from "./StatusBadge";

function fmtDateLong(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

const APPROVAL_PILL = {
  Pending: { key: "pending", icon: "bi-hourglass-split", label: "Awaiting Approval" },
  Approved: { key: "approved", icon: "bi-check-circle", label: "Approved" },
  Rejected: { key: "rejected", icon: "bi-x-circle", label: "Rejected" },
};

/** One Change Order card — CO#/type on top, then status (left) / edit+delete
 * (right) on their own row, notes, linked-submissions chips, date/hours
 * summary chips, then created-by along the bottom. Team-lead COs
 * (`requires_approval`) also get an approval pill, who can approve it, and
 * Approve/Reject buttons for those approvers (`onApproval`). */
export default function ChangeOrderCard({ co, canEdit, canDelete, onEdit, onDelete, onApproval, showTotal = true, submissionOptions = [] }) {
  const status = getChangeOrderStatus(co);
  // Approved is already spelled out in the "Approved by …" line below, so skip the pill for it.
  const approvalPill =
    co.requires_approval && co.approval !== "Approved" ? APPROVAL_PILL[co.approval] || APPROVAL_PILL.Pending : null;
  const showApprovalButtons = co.requires_approval && co.can_approve && onApproval;
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
        <div className="co-card-pills">
          <span className={`co-status-pill co-status-${status.key}`}>
            <i className={`bi ${status.icon}`} /> {status.label.toUpperCase()}
          </span>
          {approvalPill && (
            <span
              className={`co-status-pill co-approval-${approvalPill.key}`}
              title={co.approval_by ? `${co.approval} by ${co.approval_by}` : undefined}
            >
              <i className={`bi ${approvalPill.icon}`} /> {approvalPill.label.toUpperCase()}
            </span>
          )}
        </div>
        <div className="co-card-actions">
          {showApprovalButtons && co.approval !== "Approved" && (
            <button type="button" className="btn btn-sm btn-success" onClick={() => onApproval(co, "Approved")}>
              <i className="bi bi-check-lg" /> Approve
            </button>
          )}
          {showApprovalButtons && co.approval !== "Rejected" && co.approval !== "Approved" && (
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => onApproval(co, "Rejected")}>
              <i className="bi bi-x-lg" /> Reject
            </button>
          )}
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

      {co.requires_approval && co.approval !== "Pending" && (
        <div className="co-approval-info">
          <i className="bi bi-shield-check" /> {co.approval} by {co.approval_by || "—"}
          {co.approval_at ? ` on ${fmtDateLong(co.approval_at)}` : ""}
        </div>
      )}

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
