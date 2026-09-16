const mongoose = require("mongoose");

/**
 * Singleton document (fixed _id) holding app-wide settings that don't belong
 * to any one user/team/record, configured from the Settings page (admin-only).
 * For every list here, admins can always do the thing regardless of whether
 * they're on it — it's who *else* is allowed to.
 */
const settingsSchema = new mongoose.Schema({
  _id: { type: String, default: "app" },
  // Stored as User _ids (not usernames) so renaming a user — Settings > Users
  // allows that — can never silently drop a permission already granted to
  // them. The Settings page still searches/displays by username; routes.js
  // (server/src/routes/settings.js) translates at the read/write boundary.
  invoiceReleaseEditors: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  recordUpdaters: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  recordDeleters: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  coDeleters: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  rfiDeleters: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  completedLogEditors: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
});

module.exports = mongoose.model("Settings", settingsSchema);
