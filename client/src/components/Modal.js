"use client";

// Modal header colors, ported from the Flask app's per-purpose inline styles
// (default navy for most modals, purple for hold-attachment, red for delete,
// the one gradient header for record-info, indigo for editing-log modals).
const HEADER_CLASS = {
  navy: "",
  purple: "header-purple",
  danger: "header-danger",
  indigo: "header-indigo",
  gradientBlue: "header-gradient-blue",
  importUsers: "header-import-users",
  bulkBirthday: "header-bulk-birthday",
  deadlines: "header-deadlines",
};

/** Minimal custom modal — deliberately not dependent on Bootstrap's JS (which fights React's DOM diffing). */
export default function Modal({ open, onClose, title, children, footer, maxWidth, theme = "navy", bodyClassName = "", aboveModals = false }) {
  if (!open) return null;
  return (
    <div
      className={`st-modal-backdrop${aboveModals ? " st-modal-backdrop-top" : ""}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="st-modal" style={maxWidth ? { maxWidth } : undefined}>
        <div className={`st-modal-header ${HEADER_CLASS[theme] || ""}`}>
          <h5 className="m-0">{title}</h5>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>
        <div className={`st-modal-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
        {footer && <div className="st-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
