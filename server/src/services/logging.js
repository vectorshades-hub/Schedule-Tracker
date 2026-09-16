const { v4: uuidv4 } = require("uuid");
const { ActivityLog, Notification } = require("../models");

/**
 * Fire-and-forget, mirrors app.py's write_log() (spawned in a daemon thread
 * there). `project` is optional and only meaningful to a handful of callers
 * (Change Order/RFI deletes) — it lets a submission's Activity panel query
 * back "this got deleted" after the document itself is gone; every other
 * caller omits it and behaves exactly as before.
 */
function writeLog(action, detail = "", user = "web", project) {
  const doc = { username: user, action, detail };
  if (project) doc.project = project;
  ActivityLog.create(doc).catch((e) => console.error("[LOG ERROR]", e.message));
}

/** Fire-and-forget, mirrors app.py's push_notification(). */
function pushNotification(action, detail, user) {
  const id = uuidv4().slice(0, 16);
  Notification.create({ _id: id, action, detail, byUser: user, seenBy: [] }).catch((e) =>
    console.error("[NOTIF ERROR]", e.message)
  );
}

async function getUnseenCount(username = "") {
  try {
    return await Notification.countDocuments({ seenBy: { $ne: username } });
  } catch {
    return 0;
  }
}

async function markSeenForUser(notifId, username) {
  await Notification.updateOne({ _id: notifId }, { $addToSet: { seenBy: username } });
}

async function markAllSeenForUser(username) {
  await Notification.updateMany({ seenBy: { $ne: username } }, { $addToSet: { seenBy: username } });
}

/** Parses the pipe-delimited `k=v|k=v` detail strings used by ADD/UPDATE notifications. */
function parseNotifDetail(detail) {
  const result = {};
  for (const part of String(detail || "").split("|")) {
    const idx = part.indexOf("=");
    if (idx >= 0) result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return result;
}

function buildAddDetail(rid, project, subName, client, subType, team, subDate, dueDate, remarks, status) {
  return (
    `record_id=${rid}|project=${project}|submission=${subName}|` +
    `client=${client}|type=${subType}|team=${team}|` +
    `sub_date=${subDate}|due_date=${dueDate}|remarks=${remarks}|status=${status}`
  );
}

function buildUpdateDetail(rid, before, after) {
  const changes = [];
  for (const k of Object.keys(after)) {
    const bv = String(before[k] ?? "").trim();
    const av = String(after[k] ?? "").trim();
    if (bv !== av) changes.push(`${k}: '${bv}'→'${av}'`);
  }
  return `record_id=${rid}|` + changes.join("|");
}

module.exports = {
  writeLog,
  pushNotification,
  getUnseenCount,
  markSeenForUser,
  markAllSeenForUser,
  parseNotifDetail,
  buildAddDetail,
  buildUpdateDetail,
};
