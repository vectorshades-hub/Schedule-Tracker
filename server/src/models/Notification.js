const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // uuid, matches legacy id format
  ts: { type: Date, default: Date.now, index: true },
  action: { type: String, default: "" },
  detail: { type: String, default: "" },
  byUser: { type: String, default: "" },
  // Real array + $in/$nin matching — the original stored a comma-joined
  // string and matched with `NOT LIKE '%user%'`, a substring check that
  // could false-positive when one username is a substring of another.
  seenBy: { type: [String], default: [] },
});

module.exports = mongoose.model("Notification", notificationSchema);
