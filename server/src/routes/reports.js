const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const ExcelJS = require("exceljs");
const { requireRole } = require("../middleware/auth");
const { loadRecords } = require("../services/recordVisibility");

const router = createSafeRouter();

/** POST /api/reports/export — admin/management, ad-hoc filtered Excel export (org-wide, bypasses caller's own team scoping — matches the original). */
router.post("/export", requireRole("admin", "management"), async (req, res) => {
  const b = req.body;
  let records = await loadRecords("", "admin");

  const eq = (val, filter) => !filter || String(val || "").toLowerCase() === String(filter).toLowerCase();
  const startsWith = (val, filter) => !filter || String(val || "").toUpperCase().startsWith(String(filter).toUpperCase());

  if (b.f_team) records = records.filter((r) => eq(r.team, b.f_team));
  if (b.f_project) records = records.filter((r) => eq(r.project, b.f_project));
  if (b.f_client) records = records.filter((r) => eq(r.client, b.f_client));
  if (b.f_type) records = records.filter((r) => eq(r.submission_type, b.f_type));
  if (b.f_status) records = records.filter((r) => startsWith(r.status, b.f_status));
  if (b.f_created_by) {
    const cb = String(b.f_created_by).toLowerCase();
    records = records.filter((r) => r.created_by.toLowerCase().includes(cb));
  }
  if (b.f_sub_from) records = records.filter((r) => (r.sub_date_raw || "") >= b.f_sub_from);
  if (b.f_sub_to) records = records.filter((r) => (r.sub_date_raw || "") <= b.f_sub_to);
  if (b.f_due_from) records = records.filter((r) => (r.due_date_raw || "") >= b.f_due_from);
  if (b.f_due_to) records = records.filter((r) => (r.due_date_raw || "") <= b.f_due_to);

  const groupBy = ["project", "client", "team"].includes(b.group_by) ? b.group_by : "project";
  const groupKey = { project: "project", client: "client", team: "team" }[groupBy];
  records.sort((a, b2) => a[groupKey].localeCompare(b2[groupKey]));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow(["ID", "Project", "Submission", "Client", "Type", "Team", "Sub Date", "Due Date", "Remarks", "Status", "QC Done", "Created By", "Created At"]);
  for (const r of records) {
    ws.addRow([r.id, r.project, r.submission_name, r.client, r.submission_type, r.team, r.sub_date, r.due_date, r.remarks, r.status, r.qaqc, r.created_by, r.created_at]);
  }

  const ts = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const filename = `report_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
