const { ChangeOrder } = require("../models");
const { writeLog } = require("./logging");

/**
 * A billable submission automatically gets its own Change Order — called
 * after every path that can set a record's `billable` field (create, edit,
 * the dashboard's inline toggle, and the CSV bulk uploader). No-ops unless
 * `record.billable === "Yes"`, and is idempotent per submission via
 * `sourceRecordId` (so toggling Billable off and back on, or re-saving an
 * already-billable record, never adds a second CO for the same submission).
 *
 * Returns true if a Change Order was created, false otherwise (not
 * billable, or one already exists for this submission).
 */
async function ensureBillableChangeOrder(record, user) {
  if (record.billable !== "Yes") return false;
  if (await ChangeOrder.exists({ sourceRecordId: record.legacyId })) return false;

  // CO # is a per-project 3-digit sequence — 001, 002, ... — continuing
  // from whatever numeric CO #s already exist for this project (manually
  // entered non-numeric ones, if any, are ignored for this purpose).
  const existingCOs = await ChangeOrder.find({ project: record.project }, { coNumber: 1 }).lean();
  let maxNum = 0;
  for (const co of existingCOs) {
    const n = Number(co.coNumber);
    if (Number.isInteger(n) && n > maxNum) maxNum = n;
  }
  const coNumber = String(maxNum + 1).padStart(3, "0");

  await ChangeOrder.create({
    project: record.project,
    coNumber,
    team: record.team || "",
    date: record.subDate || null,
    changeType: record.submissionName || "",
    notes: `Auto-added from submission #${record.legacyId} (${record.submissionName})`,
    hours: 0,
    approval: "Pending",
    billed: false,
    createdBy: user,
    createdAt: new Date(),
    sourceRecordId: record.legacyId,
  });
  writeLog("AUTO-ADD-CHANGE-ORDER", `project='${record.project}' co='${coNumber}' from record ID=${record.legacyId}`, user);
  return true;
}

module.exports = { ensureBillableChangeOrder };
