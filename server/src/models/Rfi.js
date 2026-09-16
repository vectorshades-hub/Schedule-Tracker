const mongoose = require("mongoose");

/**
 * RFI/Clarification requests — same project-level scoping convention as
 * ChangeOrder (see ChangeOrder.js): tied to `project`, not one specific
 * submission, so any submission under a project sees the same list.
 */
const rfiSchema = new mongoose.Schema({
  project: { type: String, required: true, index: true },
  type: { type: String, default: "RFI" }, // RFI | Clarification | BFA Clarification | Field Verification | GC to Verify | Other
  title: { type: String, required: true },
  description: { type: String, default: "" },
  date: { type: Date, default: null },
  expectedResponseDate: { type: Date, default: null },
  actualReturnDate: { type: Date, default: null }, // optional — set once answered
  createdBy: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: "" },
  updatedAt: { type: Date, default: null },
});

module.exports = mongoose.model("Rfi", rfiSchema);
