const mongoose = require("mongoose");

/**
 * BFA / IFA tracking entries — one per transmittal (a completed submission)
 * sent to the customer and awaiting return. Project-scoped like Rfi and
 * ChangeOrder. Feeds section 4 of the Weekly Project Status report.
 *
 * Days awaited is computed live from the submission's due date to today
 * (routes/bfas.js daysAwaited), unless `daysAwaitedOverride` is set by hand.
 */
const bfaSchema = new mongoose.Schema({
  project: { type: String, required: true, index: true },
  trNumber: { type: String, default: "" }, // transmittal number, typed by the user
  submissionId: { type: Number, required: true }, // Record.legacyId — the submission sent
  submittedDate: { type: Date, default: null },
  // "Yes" once closed out; only "No" entries go on the Weekly Status report.
  status: { type: String, enum: ["Yes", "No"], default: "No" },
  description: { type: String, default: "" },
  daysAwaitedOverride: { type: Number, default: null, min: 0 },
  createdBy: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: "" },
  updatedAt: { type: Date, default: null },
});

module.exports = mongoose.model("Bfa", bfaSchema);
