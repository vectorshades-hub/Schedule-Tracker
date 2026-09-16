"use client";

/**
 * The gradient "hero banner" pattern reused across 8 Flask pages (users.html,
 * completed_log.html, notifications.html, request_log.html, editing_log.html,
 * projects.html, project_submissions.html, client_submissions.html) — same
 * shape everywhere, only the gradient theme differs per page.
 */
export default function PageHero({ theme = "navy", icon, title, meta, right }) {
  return (
    <div className={`hero-banner hero-${theme}`}>
      <div className="hero-left">
        {icon && <div className="hero-icon"><i className={`bi ${icon}`} /></div>}
        <div>
          <div className="hero-title">{title}</div>
          {meta && <div className="hero-meta">{meta}</div>}
        </div>
      </div>
      {right && <div className="hero-right">{right}</div>}
    </div>
  );
}
