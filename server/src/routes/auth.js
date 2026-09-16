const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const { User } = require("../models");
const { writeLog } = require("../services/logging");
const { requireAuth } = require("../middleware/auth");
const {
  canEditInvoiceReleased,
  canUpdateRecords,
  canDeleteRecords,
  canDeleteChangeOrders,
  canDeleteRfis,
  canEditCompletedLog,
} = require("../services/settingsService");

const router = createSafeRouter();

/** GET /api/auth/usernames — populates the login page's searchable name picker. */
router.get("/usernames", async (req, res) => {
  const users = await User.find({}).sort({ username: 1 }).select("username").lean();
  res.json({ usernames: users.map((u) => u.username) });
});

/** POST /api/auth/login — { username, password } */
router.post("/login", async (req, res) => {
  const name = String(req.body.username || "").trim();
  const pw = String(req.body.password || "").trim();

  if (!name) {
    return res.status(400).json({ ok: false, error: "Please enter your name." });
  }
  const user = await User.findOne({ username: name });
  if (!user || user.password !== pw) {
    return res.status(401).json({ ok: false, error: "Incorrect name or password." });
  }

  req.session.username = user.username;
  req.session.role = user.role;
  // The stable id — not the username — is what Settings' permission lists
  // are keyed by (settingsService.js), so renaming this user later can't
  // silently drop their granted permissions. See middleware/auth.js for the
  // matching backfill on already-logged-in sessions.
  req.session.userId = String(user._id);

  writeLog("STARTUP", `Logged in | role=${user.role}`, user.username);

  res.json({
    ok: true,
    user: {
      username: user.username,
      role: user.role,
      birthday: user.birthday || "",
      can_edit_invoice_released: await canEditInvoiceReleased(user._id, user.role),
      can_update_records: await canUpdateRecords(user._id, user.role),
      can_delete_records: await canDeleteRecords(user._id, user.role),
      can_delete_change_orders: await canDeleteChangeOrders(user._id, user.role),
      can_delete_rfis: await canDeleteRfis(user._id, user.role),
      can_edit_completed_log: await canEditCompletedLog(user._id, user.role),
    },
  });
});

/**
 * POST /api/auth/bootstrap-admin — { username, password }. Creates the first
 * admin user with no auth required, but ONLY when the Users collection is
 * completely empty (e.g. after an accidental wipe) — every other user-create
 * path (POST /api/users, the navbar "Add User" modal) requires an existing
 * admin session, which is impossible when there are zero users at all. Once
 * any user exists, this route always 409s — it cannot be used to create a
 * second admin or bypass normal auth.
 */
router.post("/bootstrap-admin", async (req, res) => {
  const existing = await User.countDocuments();
  if (existing > 0) {
    return res.status(409).json({ ok: false, error: "Users already exist — use the normal Add User flow instead." });
  }
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: "username and password are required." });
  }
  await User.create({ username, password, role: "admin" });
  writeLog("BOOTSTRAP-ADMIN", `Created first admin user '${username}'`, username);
  res.json({ ok: true, message: `Admin user '${username}' created. You can now log in normally.` });
});

router.post("/logout", (req, res) => {
  const user = req.session.username || "unknown";
  req.session.destroy(() => {
    writeLog("CLOSE", "Logged out", user);
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

/** GET /api/auth/me — lets the client bootstrap auth state on load/refresh. */
router.get("/me", requireAuth, async (req, res) => {
  const user = await User.findOne({ username: req.session.username }).lean();
  if (!user) return res.status(401).json({ ok: false, error: "Not authenticated" });
  res.json({
    ok: true,
    user: {
      username: user.username,
      role: user.role,
      birthday: user.birthday || "",
      can_edit_invoice_released: await canEditInvoiceReleased(user._id, user.role),
      can_update_records: await canUpdateRecords(user._id, user.role),
      can_delete_records: await canDeleteRecords(user._id, user.role),
      can_delete_change_orders: await canDeleteChangeOrders(user._id, user.role),
      can_delete_rfis: await canDeleteRfis(user._id, user.role),
      can_edit_completed_log: await canEditCompletedLog(user._id, user.role),
    },
  });
});

module.exports = router;
