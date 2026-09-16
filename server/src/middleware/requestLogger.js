const { RequestLog } = require("../models");

// Paths excluded from the audit log — mirrors _REQLOG_SKIP in app.py.
const SKIP_PREFIXES = ["/api/hold/image/", "/favicon"];

/** Mirrors app.py's @app.before_request/@app.after_request request-log pair.
 * Only logs write requests (POST/PUT/PATCH/DELETE) — read-only GET/HEAD traffic
 * is high-volume and not useful for an audit trail of who changed what. */
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    if (["GET", "HEAD"].includes(req.method)) return;
    const path = req.path;
    if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return;
    const durationMs = Date.now() - start;
    const session = req.session || {};
    // Fire-and-forget, exactly like the original's daemon thread — never blocks the response.
    RequestLog.create({
      method: req.method,
      path,
      status: String(res.statusCode),
      username: session.username || "—",
      role: session.role || "—",
      ip: req.headers["x-forwarded-for"] || req.ip || "—",
      durationMs,
      userAgent: (req.headers["user-agent"] || "").slice(0, 120),
    }).catch(() => {});
  });
  next();
}

module.exports = requestLogger;
