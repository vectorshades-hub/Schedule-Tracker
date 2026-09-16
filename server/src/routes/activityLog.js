const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const { ActivityLog } = require("../models");
const { requireRole, requireAuth } = require("../middleware/auth");

const router = createSafeRouter();

/**
 * GET /api/activity-log/project?project=X — any authenticated user (not
 * admin-only, unlike / below) — feeds the submission detail page's Activity
 * panel with "deleted" events it can't reconstruct from the Change
 * Order/RFI collections themselves (the document is gone). Only entries
 * written with a `project` (currently just DELETE-CHANGE-ORDER/DELETE-RFI —
 * see logging.js's writeLog()) ever match here; everything else in the app's
 * activity log leaves `project` blank and is invisible to this route.
 * Registered before "/" so this literal path can't be shadowed by anything.
 */
router.get("/project", requireAuth, async (req, res) => {
  const project = String(req.query.project || "").trim();
  if (!project) return res.json({ entries: [] });
  const rows = await ActivityLog.find({ project }).sort({ ts: -1 }).limit(100).lean();
  res.json({
    entries: rows.map((r) => ({ ts: new Date(r.ts).toISOString(), user: r.username, title: r.detail })),
  });
});

const TAG_MAP = { ADD: "success", UPDATE: "warning", DELETE: "danger", COMPLETED: "info", STARTUP: "secondary", CLOSE: "secondary" };

/** GET /api/activity-log — admin only (role check is the only gate — no separate log password anymore). */
router.get("/", requireRole("admin"), async (req, res) => {
  const rows = await ActivityLog.find({ action: { $ne: "AUTO-HIDE" } })
    .sort({ ts: -1 })
    .limit(2000)
    .lean();
  const entries = rows.map((r) => {
    const firstWord = (r.action || "").split(/[\s-]/)[0].toUpperCase();
    return {
      ts: new Date(r.ts).toISOString().slice(0, 19).replace("T", " "),
      user: r.username,
      action: r.action,
      detail: r.detail,
      badge: TAG_MAP[firstWord] || "secondary",
    };
  });
  res.json({ entries });
});

module.exports = router;
