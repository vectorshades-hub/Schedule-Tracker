const mongoose = require("mongoose");

const editingLogSchema = new mongoose.Schema({
  logId: { type: String, required: true, index: true }, // uuid, shared by every row from one upload batch
  uploadedAt: { type: Date, default: Date.now },
  project: { type: String, required: true, index: true },
  client: { type: String, required: true, index: true },
  filename: { type: String, default: "" },
  uploadedBy: { type: String, default: "" },
  sheetName: { type: String, default: "" },
  sheetType: { type: String, enum: ["Detail", "Erection"], default: "Detail" },
  detailedBy: { type: String, default: "" },
  checkedBy: { type: String, default: "" },
  correctedBy: { type: String, default: "" },
  qcDone: { type: String, default: "" }, // "Yes" | "No" | ""
  qcComment: { type: String, default: "" },
  remarks: { type: String, default: "" },
  detailedByDone: { type: String, default: "0" }, // "1" | "0"
  checkedByDone: { type: String, default: "0" },
  correctedByDone: { type: String, default: "0" },
  qcCommentDone: { type: String, default: "0" },
  allowedUsers: { type: [String], default: [] },
});

module.exports = mongoose.model("EditingLog", editingLogSchema);
