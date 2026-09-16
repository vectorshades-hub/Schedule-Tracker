const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const { RequestLog } = require("../models");
const { requireRole } = require("../middleware/auth");

const router = createSafeRouter();

/** GET /api/request-log — admin only (role check is the only gate — no separate request-log password anymore). */
router.get("/", requireRole("admin"), async (req, res) => {
  const rows = await RequestLog.find({}).sort({ ts: -1 }).limit(5000).lean();
  const entries = rows.map((r) => ({
    ts: new Date(r.ts).toISOString(),
    method: r.method,
    path: r.path,
    status: r.status,
    username: r.username,
    role: r.role,
    ip: r.ip,
    duration: `${r.durationMs}ms`,
    user_agent: r.userAgent,
  }));

  const methods = {},
    statuses = {},
    users = {};
  for (const r of rows) {
    methods[r.method] = (methods[r.method] || 0) + 1;
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    users[r.username] = (users[r.username] || 0) + 1;
  }

  res.json({ entries, aggregates: { methods, statuses, users } });
});

module.exports = router;
