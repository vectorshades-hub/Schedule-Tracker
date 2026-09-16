const mongoose = require("mongoose");

const completedLogSchema = new mongoose.Schema({
  archivedAt: { type: Date, default: Date.now, index: true },
  recordId: { type: Number, default: null },
  project: { type: String, default: "" },
  submissionName: { type: String, default: "" },
  client: { type: String, default: "" },
  submissionType: { type: String, default: "" },
  steelType: { type: String, default: "" },
  team: { type: String, default: "" },
  subDate: { type: String, default: "" },
  dueDate: { type: String, default: "" },
  remarks: { type: String, default: "" },
  createdAt: { type: String, default: "" },
  completedAt: { type: String, default: "" },
  createdBy: { type: String, default: "" },
  archivedBy: { type: String, default: "" },
  qaqc: { type: String, default: "" },
  percentage: { type: Number, default: 0 },
  billable: { type: String, default: "" }, // "Yes" | "No" | ""
  invoiceReleased: { type: String, default: "" }, // "Yes" | "No" | ""
});

completedLogSchema.index({ recordId: 1 });

module.exports = mongoose.model("CompletedLog", completedLogSchema);
