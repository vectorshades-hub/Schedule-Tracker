const { User } = require("../models");

/**
 * Sessions get `userId` set at login (see routes/auth.js) — it's the stable
 * reference used everywhere a permission check needs to survive a username
 * rename (Settings' recordUpdaters/recordDeleters/invoiceReleaseEditors are
 * stored by id, not name — see settingsService.js). Any session created
 * before this existed won't have it yet, so it's lazily backfilled here:
 * one lookup, then cached on the session for every request after.
 */
async function ensureUserId(req) {
  if (req.session.userId || !req.session.username) return;
  const u = await User.findOne({ username: req.session.username }).select("_id").lean();
  if (u) req.session.userId = String(u._id);
}

/** Mirrors Flask's `login_required` decorator + inline role checks scattered through app.py. */
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.username || !req.session.role) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }
  await ensureUserId(req);
  next();
}

/** Mirrors the many `if session.get("role") not in (...)` checks in app.py. */
function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.session || !req.session.username || !req.session.role) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ ok: false, error: "Permission denied" });
    }
    await ensureUserId(req);
    next();
  };
}

module.exports = { requireAuth, requireRole };
