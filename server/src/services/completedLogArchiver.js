const { CompletedLog } = require("../models");

/**
 * Archives a completed record snapshot into CompletedLog. Ported from
 * app.py's `_archive_record_db()`. Note: the original also defines
 * `_run_grace_period_cleanup()` / `_archive_and_delete_record()` for an
 * "auto-archive" path, but grep confirms that function is never actually
 * invoked anywhere in app.py (dead code) — only the manual COMPLETE-via-
 * update path calls this, so that's the only path ported here.
 */
async function archiveRecord(record, archivedBy = "system") {
  try {
    const existing = await CompletedLog.findOne({ recordId: record.legacyId });
    if (existing) {
      if (record.qaqc && !existing.qaqc) {
        await CompletedLog.updateOne({ _id: existing._id }, { qaqc: record.qaqc });
      }
      return;
    }
    await CompletedLog.create({
      archivedAt: new Date(),
      recordId: record.legacyId,
      project: record.project || "",
      submissionName: record.submissionName || "",
      client: record.client || "",
      submissionType: record.submissionType || "",
      steelType: record.steelType || "",
      team: record.team || "",
      subDate: record.subDate ? new Date(record.subDate).toISOString().slice(0, 10) : "",
      dueDate: record.dueDate ? new Date(record.dueDate).toISOString().slice(0, 10) : "",
      remarks: record.remarks || "",
      createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : "",
      completedAt: record.completedAt ? new Date(record.completedAt).toISOString() : "",
      createdBy: record.createdBy || "",
      archivedBy,
      qaqc: record.qaqc || "",
      percentage: record.percentage ?? 0,
      billable: record.billable || "",
      invoiceReleased: record.invoiceReleased || "",
    });
  } catch (e) {
    console.error("[ARCHIVE ERROR]", e.message);
  }
}

module.exports = { archiveRecord };
