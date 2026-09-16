const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const { User, Settings } = require("../models");
const { requireRole } = require("../middleware/auth");
const { getSettings } = require("../services/settingsService");
const { writeLog } = require("../services/logging");

const router = createSafeRouter();

/** GET /api/settings — admin only; feeds the Settings page. Settings.js stores each
 * permission list as User _ids (see settingsService.js) — the page itself still
 * works in usernames, so this resolves ids -> usernames using the same `users`
 * lookup it already needs for the picker. */
router.get("/", requireRole("admin"), async (req, res) => {
  const [settings, users] = await Promise.all([
    getSettings(),
    User.find({}).sort({ username: 1 }).select("username role").lean(),
  ]);
  const usernameById = new Map(users.map((u) => [String(u._id), u.username]));
  const toUsernames = (ids) => (ids || []).map((id) => usernameById.get(String(id))).filter(Boolean);

  res.json({
    invoice_release_editors: toUsernames(settings.invoiceReleaseEditors),
    record_updaters: toUsernames(settings.recordUpdaters),
    record_deleters: toUsernames(settings.recordDeleters),
    co_deleters: toUsernames(settings.coDeleters),
    rfi_deleters: toUsernames(settings.rfiDeleters),
    completed_log_editors: toUsernames(settings.completedLogEditors),
    users: users.map((u) => ({ username: u.username, role: u.role })),
  });
});

/**
 * POST /api/settings — admin only. Each of invoice_release_editors /
 * record_updaters / record_deleters / co_deleters / rfi_deleters is optional
 * and independent — the Settings page saves one section (list) at a time, so
 * only whichever key is present in the body gets updated; the others are
 * left as-is. The page sends usernames (that's what its picker works in);
 * this resolves them to _ids before writing, since that's how Settings.js
 * actually stores them (survives a later username rename).
 */
router.post("/", requireRole("admin"), async (req, res) => {
  const cleanUsernames = (arr) =>
    Array.isArray(arr) ? [...new Set(arr.map((u) => String(u || "").trim()).filter(Boolean))] : null;

  const invoiceUsernames = cleanUsernames(req.body.invoice_release_editors);
  const updaterUsernames = cleanUsernames(req.body.record_updaters);
  const deleterUsernames = cleanUsernames(req.body.record_deleters);
  const coDeleterUsernames = cleanUsernames(req.body.co_deleters);
  const rfiDeleterUsernames = cleanUsernames(req.body.rfi_deleters);
  const completedLogEditorUsernames = cleanUsernames(req.body.completed_log_editors);

  const allUsernames = [
    ...new Set([
      ...(invoiceUsernames || []),
      ...(updaterUsernames || []),
      ...(deleterUsernames || []),
      ...(coDeleterUsernames || []),
      ...(rfiDeleterUsernames || []),
      ...(completedLogEditorUsernames || []),
    ]),
  ];
  const matched = allUsernames.length ? await User.find({ username: { $in: allUsernames } }).select("username").lean() : [];
  const idByUsername = new Map(matched.map((u) => [u.username, u._id]));
  const toIds = (usernames) => usernames.map((u) => idByUsername.get(u)).filter(Boolean);

  const update = {};
  if (invoiceUsernames) update.invoiceReleaseEditors = toIds(invoiceUsernames);
  if (updaterUsernames) update.recordUpdaters = toIds(updaterUsernames);
  if (deleterUsernames) update.recordDeleters = toIds(deleterUsernames);
  if (coDeleterUsernames) update.coDeleters = toIds(coDeleterUsernames);
  if (rfiDeleterUsernames) update.rfiDeleters = toIds(rfiDeleterUsernames);
  if (completedLogEditorUsernames) update.completedLogEditors = toIds(completedLogEditorUsernames);

  const settings = await Settings.findByIdAndUpdate("app", update, { upsert: true, new: true }).lean();
  writeLog("SETTINGS-UPDATE", JSON.stringify(update), req.session.username);

  // Re-resolve ids -> usernames for the response, covering the full saved
  // lists (not just whichever section this request touched).
  const allIds = [
    ...(settings.invoiceReleaseEditors || []),
    ...(settings.recordUpdaters || []),
    ...(settings.recordDeleters || []),
    ...(settings.coDeleters || []),
    ...(settings.rfiDeleters || []),
    ...(settings.completedLogEditors || []),
  ].map(String);
  const idUsers = allIds.length ? await User.find({ _id: { $in: allIds } }).select("username").lean() : [];
  const usernameById = new Map(idUsers.map((u) => [String(u._id), u.username]));
  const toUsernames = (ids) => (ids || []).map((id) => usernameById.get(String(id))).filter(Boolean);

  res.json({
    ok: true,
    invoice_release_editors: toUsernames(settings.invoiceReleaseEditors),
    record_updaters: toUsernames(settings.recordUpdaters),
    record_deleters: toUsernames(settings.recordDeleters),
    co_deleters: toUsernames(settings.coDeleters),
    rfi_deleters: toUsernames(settings.rfiDeleters),
    completed_log_editors: toUsernames(settings.completedLogEditors),
  });
});

module.exports = router;
