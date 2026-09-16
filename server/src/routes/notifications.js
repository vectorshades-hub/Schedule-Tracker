const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const { Notification } = require("../models");
const { requireRole } = require("../middleware/auth");
const { markSeenForUser, markAllSeenForUser, getUnseenCount } = require("../services/logging");

const router = createSafeRouter();

const ACTION_LABELS = { ADD: "New Record Added", UPDATE: "Record Updated", COMPLETED: "Record Completed", DELETE: "Record Deleted" };

/** Splits the pipe-delimited detail string into plain k=v fields and 'field: old→new' change entries. */
function parseDetail(detail) {
  const fields = {};
  const changes = [];
  for (const part of String(detail || "").split("|")) {
    let m;
    if ((m = part.match(/^([A-Za-z_]+)=(.*)$/))) {
      fields[m[1].trim()] = m[2];
    } else if ((m = part.match(/^(.+?):\s*'(.*)'→'(.*)'$/))) {
      changes.push({ field: m[1].trim(), old_value: m[2], new_value: m[3] });
    }
  }
  return { fields, changes };
}

/** GET /api/notifications — admin/management; marks everything seen as a side effect (matches original). */
router.get("/", requireRole("admin", "management"), async (req, res) => {
  const username = req.session.username;
  await markAllSeenForUser(username);

  const rows = await Notification.find({}).sort({ ts: -1 }).limit(500).lean();
  const entries = rows.map((r) => {
    const actionKey = (r.action || "").toUpperCase();
    const { fields, changes } = parseDetail(r.detail);
    return {
      id: r._id,
      ts: new Date(r.ts).toISOString(),
      action: r.action,
      action_label: ACTION_LABELS[actionKey] || r.action,
      detail: r.detail,
      by_user: r.byUser,
      seen: (r.seenBy || []).includes(username),
      fields,
      changes,
    };
  });
  res.json({ entries });
});

/** POST /api/notifications/mark-seen — { notif_id }. */
router.post("/mark-seen", requireRole("admin", "management"), async (req, res) => {
  const notifId = String(req.body.notif_id || "").trim();
  await markSeenForUser(notifId, req.session.username);
  res.json({ ok: true });
});

/** GET /api/notifications/unseen-count — poll endpoint for the navbar bell (5-min interval on the client). */
router.get("/unseen-count", async (req, res) => {
  const { username, role } = req.session || {};
  if (!username || !["admin", "management"].includes(role)) {
    return res.json({ count: 0, latest: [] });
  }
  try {
    const count = await getUnseenCount(username);
    const recent = await Notification.find({}).sort({ ts: -1 }).limit(20).lean();
    const latest = [];
    for (const r of recent) {
      if ((r.seenBy || []).includes(username)) continue;
      const actionKey = (r.action || "").toUpperCase();
      const { fields } = parseDetail(r.detail);
      latest.push({
        id: r._id,
        title: ACTION_LABELS[actionKey] || r.action,
        body: fields.project ? `${fields.project} / ${fields.submission || ""}`.trim() : r.detail,
        user: r.byUser,
      });
      if (latest.length >= 5) break;
    }
    res.json({ count, latest });
  } catch {
    res.json({ count: 0, latest: [] });
  }
});

module.exports = router;
