require("dotenv").config();

function bool(v, def) {
  if (v === undefined) return def;
  return v === "1" || v === "true";
}

module.exports = {
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/schedule_tracker",
  port: parseInt(process.env.PORT || "8008", 10),
  sessionSecret: process.env.SESSION_SECRET || "dev-secret-change-me",

  // Record/Change Order/RFI delete no longer use a shared password — see
  // settingsService.js's canDeleteRecords()/canDeleteChangeOrders()/canDeleteRfis()
  // (Settings page, per-user lists). deletePassword is still used for Projects/Clients.
  deletePassword: process.env.DELETE_PASSWORD || "delete@vs2026",
  logPassword: process.env.LOG_PASSWORD || "log@vs2005",
  reqlogPassword: process.env.REQLOG_PASSWORD || "req@logvs123",

  completedDaysGrace: parseInt(process.env.COMPLETED_DAYS_GRACE || "5", 10),
  completedDaysGraceExtended: parseInt(process.env.COMPLETED_DAYS_GRACE_EXTENDED || "15", 10),
  dueSoonDays: parseInt(process.env.DUE_SOON_DAYS || "3", 10),

  uploadDir: process.env.UPLOAD_DIR || "./uploads",
  backupDir: process.env.BACKUP_DIR || "./uploads/backups",
  backupRetentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || "60", 10),

  submissionTypes: ["OFA", "FAB", "REAPPROVAL", "REVISION", "FOR REVIEW", "FIELD USE"],
  allowedImageExts: [".jpg", ".jpeg", ".png", ".gif", ".webp"],

  pg: {
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432", 10),
    database: process.env.PG_DATABASE || "new_schedule_track",
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "",
  },
};
