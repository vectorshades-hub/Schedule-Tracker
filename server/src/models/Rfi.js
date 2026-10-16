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

// One cloud markup on an uploaded PDF, tying a region of a page to one
// question. Coordinates are fractions (0–1) of the page's width/height, so
// they stay put at any zoom level. labelX/labelY anchor the callout label.
const rfiMarkSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    questionId: { type: String, required: true },
    page: { type: Number, required: true }, // 1-based
    x: Number,
    y: Number,
    w: Number,
    h: Number,
    labelX: Number,
    labelY: Number,
    // Dragged leader-line geometry, both optional: lineEnd* is where the line
    // meets the box as a fraction of the box (overrides style.boxAnchor);
    // lineBend* is an elbow point as a fraction of the page.
    lineEndX: { type: Number, default: undefined },
    lineEndY: { type: Number, default: undefined },
    lineBendX: { type: Number, default: undefined },
    lineBendY: { type: Number, default: undefined },
    // Appearance overrides from the workspace's Style panel (validated by
    // rfis.js's parseMarkStyle); missing keys fall back to the client default.
    style: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { _id: false }
);

// An image pasted or dropped onto a page of a markup PDF. Same 0–1 page
// fractions as marks; the file sits next to the PDFs in uploads/rfi_markups.
// `locked` pins it in place (it can no longer be dragged or resized).
const rfiMarkupImageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    filename: { type: String, required: true },
    page: { type: Number, required: true }, // 1-based
    x: Number,
    y: Number,
    w: Number,
    h: Number,
    locked: { type: Boolean, default: false },
  },
  { _id: false }
);

// A PDF uploaded through the RFI "Mark Up" workspace, plus its marks. The
// file itself lives in uploads/rfi_markups (see fileStorage.RFI_MARKUPS_DIR).
const rfiMarkupDocSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    originalName: { type: String, default: "" },
    uploadedBy: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now },
    marks: { type: [rfiMarkSchema], default: [] },
    images: { type: [rfiMarkupImageSchema], default: [] },
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
  rfiNumber: { type: String, default: "" },
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
  markupDocs: { type: [rfiMarkupDocSchema], default: [] },
});

module.exports = mongoose.model("Rfi", rfiSchema);
