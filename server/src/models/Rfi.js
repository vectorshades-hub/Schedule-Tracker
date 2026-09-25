const mongoose = require("mongoose");

// One question within an RFI/Clarification — each is tracked and answered
// independently, so `responseReceivedDate` lives per-question rather than
// once on the whole RFI.
const rfiQuestionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    answer: { type: String, default: "" }, // optional — the response text itself, separate from responseReceivedDate
    responseReceivedDate: { type: Date, default: null },
  },
  { _id: true }
);

/**
 * RFI/Clarification requests — same project-level scoping convention as
 * ChangeOrder (see ChangeOrder.js): tied to `project`, not one specific
 * submission, so any submission under a project sees the same list.
 */
const rfiSchema = new mongoose.Schema({
  project: { type: String, required: true, index: true },
  type: { type: String, default: "RFI" }, // RFI | Clarification | BFA Clarification | Field Verification | GC to Verify | Other
  title: { type: String, required: true },
  description: { type: String, default: "" }, // legacy free-text body, kept for RFIs created before per-question tracking
  questions: { type: [rfiQuestionSchema], default: [] },
  date: { type: Date, default: null },
  expectedResponseDate: { type: Date, default: null },
  actualReturnDate: { type: Date, default: null }, // legacy whole-RFI received date, used only for RFIs with no `questions`
  createdBy: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: "" },
  updatedAt: { type: Date, default: null },
  // Submissions (Record.legacyId values) this RFI covers — an RFI can apply
  // to several submissions at once, picked on the create/edit form. Same
  // convention as ChangeOrder.linkedSubmissionIds.
  linkedSubmissionIds: { type: [Number], default: [] },
});

module.exports = mongoose.model("Rfi", rfiSchema);
