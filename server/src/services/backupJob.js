/**
 * Ported from daily_backup.py. The original ran once immediately at Flask
 * startup then every 86400s (24h) from whenever the process happened to
 * boot; here we run once at startup (same immediate-baseline behavior) and
 * then schedule via node-cron at midnight daily — a small, deliberate
 * adaptation to a fixed wall-clock schedule instead of "24h from boot",
 * which is easier to reason about operationally and has the same effect
 * (one export per calendar day).
 */
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const ExcelJS = require("exceljs");
const { Record } = require("../models");
const statusEngine = require("./statusEngine");
const env = require("../config/env");

const STATUS_FILLS = {
  COMPLETED: "FFCCE5FF",
  OVERDUE: "FFFF9999",
  "DUE SOON": "FFFFD699",
  "DUE TODAY": "FFFFD699",
  "ON TRACK": "FFC6EFCE",
  "ON HOLD": "FFE8D5FF",
  "NO DUE DATE": "FFEDEDED",
};

function fmtCell(val) {
  if (val === null || val === undefined || val === "") return "";
  if (val instanceof Date) {
    // Dates (no time component) vs timestamps — mirror _fmt()'s hasattr(val,'hour') check.
    if (val.getUTCHours() === 0 && val.getUTCMinutes() === 0 && val.getUTCSeconds() === 0) {
      return statusEngine.fmtDate(val);
    }
    const pad = (n) => String(n).padStart(2, "0");
    return `${val.getFullYear()}-${pad(val.getMonth() + 1)}-${pad(val.getDate())} ${pad(val.getHours())}:${pad(val.getMinutes())}:${pad(val.getSeconds())}`;
  }
  return String(val);
}

async function exportToExcel(filepath) {
  const rows = await Record.find({}).sort({ subDate: 1, legacyId: 1 }).lean();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Schedules");
  const headers = ["ID", "Project Name", "Submission Name", "Client Name", "Submission Type", "Team Name", "Submission Date", "Due Date", "Remarks", "Status", "Created At", "Completed At", "Created By", "QAQC"];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F3D2E" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true, size: 10 };
    cell.alignment = { horizontal: "center" };
  });

  for (const r of rows) {
    const liveStatus = statusEngine.computeStatus(r.dueDate, r.status).status;
    const row = ws.addRow([
      r.legacyId,
      r.project,
      r.submissionName,
      r.client,
      r.submissionType,
      r.team,
      fmtCell(r.subDate),
      fmtCell(r.dueDate),
      r.remarks,
      liveStatus,
      fmtCell(r.createdAt),
      fmtCell(r.completedAt),
      r.createdBy,
      r.qaqc,
    ]);
    const su = (liveStatus || "").toUpperCase();
    const matchKey = Object.keys(STATUS_FILLS).find((k) => su.startsWith(k));
    if (matchKey) {
      row.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILLS[matchKey] } }));
    }
  }

  ws.columns = [6, 40, 30, 25, 12, 20, 12, 12, 30, 28, 18, 18, 20, 8].map((width) => ({ width }));
  ws.views = [{ state: "frozen", ySplit: 1 }];

  await wb.xlsx.writeFile(filepath);
}

function deleteOldBackups() {
  const cutoff = Date.now() - env.backupRetentionDays * 86400000;
  let files;
  try {
    files = fs.readdirSync(env.backupDir);
  } catch {
    return;
  }
  for (const fname of files) {
    if (!fname.startsWith("schedule_data_") || !fname.endsWith(".xlsx")) continue;
    const datePart = fname.replace("schedule_data_", "").replace(".xlsx", "");
    const fileDate = new Date(`${datePart}T00:00:00`);
    if (isNaN(fileDate.getTime())) continue;
    if (fileDate.getTime() < cutoff) {
      try {
        fs.unlinkSync(path.join(env.backupDir, fname));
      } catch {}
    }
  }
}

async function createDailyBackup() {
  try {
    fs.mkdirSync(env.backupDir, { recursive: true });
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const filepath = path.join(env.backupDir, `schedule_data_${dateStr}.xlsx`);

    if (fs.existsSync(filepath)) {
      deleteOldBackups();
      return;
    }
    await exportToExcel(filepath);
    console.log(`[BACKUP] Created ${filepath}`);
    deleteOldBackups();
  } catch (e) {
    console.error("[BACKUP] Failed:", e.message);
  }
}

function startBackupScheduler() {
  createDailyBackup(); // immediate run at startup, mirrors the original
  cron.schedule("0 0 * * *", createDailyBackup); // then daily at midnight
}

module.exports = { createDailyBackup, deleteOldBackups, startBackupScheduler };
