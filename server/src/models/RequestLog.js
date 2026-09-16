const mongoose = require("mongoose");

const requestLogSchema = new mongoose.Schema({
  ts: { type: Date, default: Date.now }, // indexed below (with the TTL option) — not here, to avoid a duplicate index
  method: { type: String, default: "" },
  path: { type: String, default: "" },
  status: { type: String, default: "" },
  username: { type: String, default: "" },
  role: { type: String, default: "" },
  ip: { type: String, default: "" },
  durationMs: { type: Number, default: 0 },
  userAgent: { type: String, default: "" },
});

// Recommended improvement over the original (which grew forever): auto-expire
// after 90 days. Remove this index (and the field) if indefinite retention
// of the request log is actually wanted.
requestLogSchema.index({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.model("RequestLog", requestLogSchema);
