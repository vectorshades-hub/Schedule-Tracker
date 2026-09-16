const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema({
  ts: { type: Date, default: Date.now, index: true },
  username: { type: String, default: "" },
  action: { type: String, default: "" },
  detail: { type: String, default: "" },
  // Optional — only set by writeLog() calls that pass a 4th `project` arg
  // (currently just Change Order/RFI deletes), so a submission's Activity
  // panel can recover "deleted" events after the document itself is gone.
  // Every other writeLog() call in the app leaves this blank; unrelated to
  // (and doesn't change) the admin-only /api/activity-log page.
  project: { type: String, default: "", index: true },
});

module.exports = mongoose.model("ActivityLog", activityLogSchema);
