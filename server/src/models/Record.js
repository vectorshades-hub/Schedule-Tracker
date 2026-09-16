const mongoose = require("mongoose");

const holdSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" },
    imageFilename: { type: String, default: "" },
    user: { type: String, default: "" },
    ts: { type: Date, default: null },
  },
  { _id: false }
);

const recordSchema = new mongoose.Schema({
  legacyId: { type: Number, required: true, unique: true, index: true },
  project: { type: String, required: true },
  submissionName: { type: String, required: true },
  client: { type: String, required: true },
  submissionType: { type: String, required: true },
  steelType: { type: String, default: "" }, // "Main Steel" | "Misc Steel" | "Main & Misc Steel" | ""
  team: { type: String, required: true, index: true },
  subDate: { type: Date, default: null },
  dueDate: { type: Date, default: null },
  remarks: { type: String, default: "" },
  status: { type: String, default: "" }, // raw stored status string (may be "COMPLETED...", "ON HOLD", or blank/auto)
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  createdBy: { type: String, default: "", index: true },
  qaqc: { type: String, default: "" }, // "Yes" | "No" | ""
  backComment: { type: String, default: "" }, // "Yes" | "No" | ""
  furtherComment: { type: String, default: "" }, // "Yes" | "No" | ""
  billable: { type: String, default: "" }, // "Yes" | "No" | "" — admin/management only
  invoiceReleased: { type: String, default: "" }, // "Yes" | "No" | "" — admin/management only
  percentage: { type: Number, default: 0, min: 0, max: 100 }, // completion % — admin/management only
  hold: { type: holdSchema, default: () => ({}) },
  // Project-lifecycle "current stage" completion marker (client's Project
  // Lifecycle widget) — deliberately separate from `status`/`completedAt`
  // above: marking this stage done must NOT complete the record itself
  // (and, when it's the project's only record, must not complete the whole
  // project either — that still requires the real COMPLETED status).
  typeCompleted: { type: Boolean, default: false },
  typeCompletedAt: { type: Date, default: null },
});

recordSchema.index({ status: 1 });
recordSchema.index({ completedAt: 1 });

module.exports = mongoose.model("Record", recordSchema);
