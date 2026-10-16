const mongoose = require("mongoose");

// One file attached to an issue — either the client's issue email (`kind:
// "issue"`) or our reply/response email (`kind: "response"`). Usually a
// screenshot, but a saved .eml/.msg or a PDF print of the email works too.
// The file itself lives in uploads/issue_attachments (see fileStorage.ISSUE_ATTACHMENTS_DIR).
const issueAttachmentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["issue", "response"], required: true },
    filename: { type: String, required: true },
    originalName: { type: String, default: "" },
    size: { type: Number, default: 0 },
    uploadedBy: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

/**
 * Client-reported issues — logged by the production or QA team whenever an
 * issue email comes in from a client, then classified once reviewed as our
 * error or not (`status`), with the response email attached as evidence.
 */
const issueSchema = new mongoose.Schema({
  issueNumber: { type: Number, index: true },
  project: { type: String, default: "", index: true },
  client: { type: String, default: "" },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  reportedBy: { type: String, default: "" }, // the client contact who sent the email
  receivedDate: { type: Date, default: null }, // when the client's email came in
  status: { type: String, enum: ["Under Review", "Our Error", "Not Our Error"], default: "Under Review", index: true },
  responseNotes: { type: String, default: "" },
  responseDate: { type: Date, default: null },
  attachments: { type: [issueAttachmentSchema], default: [] },
  createdBy: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedBy: { type: String, default: "" },
  updatedAt: { type: Date, default: null },
});

module.exports = mongoose.model("Issue", issueSchema);
