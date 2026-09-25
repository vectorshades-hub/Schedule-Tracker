"use client";
import StatusBadge from "./StatusBadge";

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

/** Full RFI/Clarification detail — opened from RfiCard's compact row. Same
 * per-question breakdown (text, answer, its own reversible received toggle —
 * see rfis.js's POST /:id/questions/:qid/response) that used to live inline
 * in the row itself, now in a focused modal reachable from a click. */
export default function RfiDetailsModal({
  open,
  onClose,
  rfi,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onSetQuestionResponseReceived,
  submissionOptions = [],
}) {
  if (!open || !rfi) return null;

  const questions = rfi.questions || [];
  const receivedCount = questions.filter((q) => q.response_received_date).length;
  const pct = questions.length ? Math.round((receivedCount / questions.length) * 100) : 0;
  const linkedSubmissions = (rfi.linked_submission_ids || []).map(
    (id) => submissionOptions.find((s) => String(s.id) === String(id)) || { id, submission_name: "" }
  );

  function handleEdit() {
    onEdit(rfi);
    onClose();
  }

  function handleDelete() {
    onDelete(rfi);
    onClose();
  }

  return (
    <div className="st-modal-backdrop co-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal co-modal" style={{ maxWidth: 900 }}>
        <div className="co-modal-header">
          <div className="co-modal-header-icon co-modal-header-icon-amber">
            <i className="bi bi-journal-bookmark-fill" />
          </div>
          <div>
            <div className="co-modal-title">{rfi.title}</div>
            <div className="co-modal-subtitle">
              <span className="rfi-type-pill">{rfi.type}</span> RFI / Clarification Request
            </div>
          </div>
          <button type="button" className="co-modal-close" onClick={onClose} aria-label="Close">
            <i className="bi bi-x-lg" />
          </button>
        </div>

        <div className="st-modal-body">
          <div className="rfi-details-top">
            <span className={`co-status-pill rfi-status-${rfi.status.toLowerCase()}`}>
              <i className={`bi ${STATUS_ICON[rfi.status] || "bi-hourglass-split"}`} /> {rfi.status.toUpperCase()}
            </span>
            <div className="rfi-row-progress rfi-details-progress">
              <div className="rfi-row-progress-track">
                <div
                  className="rfi-row-progress-bar"
                  style={{ width: `${pct}%`, background: pct === 100 ? "#22c55e" : "#f0b429" }}
                />
              </div>
              <span className="rfi-row-progress-pct">{pct}%</span>
            </div>
            <span className="rfi-details-progress-label">
              {receivedCount}/{questions.length} questions answered
            </span>
          </div>

          {questions.length > 0 && (
            <div className="rfi-questions">
              <div className="rfi-questions-label">
                <i className="bi bi-list-check" /> Questions
              </div>
              {questions.map((q, idx) => {
                const qReceived = !!q.response_received_date;
                return (
                  <div className={`rfi-question-item${qReceived ? " rfi-question-item-received" : ""}`} key={q.id || idx}>
                    <div className="rfi-question-item-row">
                      <span className={`rfi-question-badge${qReceived ? " rfi-question-badge-received" : ""}`}>
                        {qReceived && <i className="bi bi-check-lg" />}
                        <span>Q{idx + 1}</span>
                      </span>
                      <div className="rfi-question-text">{q.text}</div>
                      <div className="rfi-question-response">
                        {qReceived ? (
                          <span className="co-chip co-chip-green">
                            <i className="bi bi-calendar-check" /> {fmtDateLong(q.response_received_date)}
                          </span>
                        ) : (
                          <span className="co-chip co-chip-amber">
                            <i className="bi bi-hourglass-split" /> No response yet
                          </span>
                        )}
                        {canEdit && q.id !== "legacy" ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={qReceived}
                            className={`switch-toggle${qReceived ? " on" : ""}`}
                            onClick={() => onSetQuestionResponseReceived(rfi, q.id, !qReceived)}
                            aria-label={`Mark question ${idx + 1} response ${qReceived ? "not received" : "received"}`}
                          >
                            <span className="switch-thumb" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {q.answer && (
                      <div className="rfi-question-answer">
                        <i className="bi bi-reply-fill" />
                        <span className="rfi-answer-tag">Answer:</span> {q.answer}
                      </div>
                    )}
                  </div>
                );
              })}
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

          <div className="co-created-by rfi-details-created-by">
            <i className="bi bi-person" /> {rfi.created_by || "—"}
          </div>
        </div>

        <div className="st-modal-footer">
          <div className="rfi-details-footer-actions">
            {canDelete && (
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={handleDelete}>
                <i className="bi bi-trash" /> Delete
              </button>
            )}
            {canEdit && (
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={handleEdit}>
                <i className="bi bi-pencil" /> Edit
              </button>
            )}
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
