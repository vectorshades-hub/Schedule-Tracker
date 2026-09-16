"use client";

/** The "locked feature" password gate — same card+icon-badge shape used by
 * notif_login.html / reqlog_login.html (icon gradient theme differs slightly). */
export default function PasswordGate({ icon, title, theme = "navy", error, password, onPasswordChange, onSubmit }) {
  return (
    <div className="gate-wrap">
      <div className="gate-card">
        <div className={`gate-icon gate-icon-${theme}`}>
          <i className={`bi ${icon}`} />
        </div>
        <h5 className="mb-3">{title}</h5>
        {error && <div className="alert alert-danger py-2">{error}</div>}
        <form onSubmit={onSubmit}>
          <input
            type="password"
            className="form-control mb-3"
            placeholder="Password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-dark w-100">
            Unlock
          </button>
        </form>
      </div>
    </div>
  );
}
