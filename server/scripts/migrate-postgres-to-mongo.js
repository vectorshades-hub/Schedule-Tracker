/**
 * One-time migration: PostgreSQL (`new_schedule_track`, the app's REAL
 * current data store — the old Excel/.dat era is already obsolete, per
 * migrate.py) → MongoDB.
 *
 * Usage:
 *   1. Copy server/.env.example to server/.env and fill in PG_* with your
 *      real Postgres credentials (and MONGO_URI if not using the default).
 *   2. `npm run migrate` from the server/ directory.
 *
 * Safe to re-run: uses upserts/dedup keys everywhere except activity_log /
 * request_log (pure event logs — re-running would duplicate them, so the
 * script skips those two if they're already non-empty in Mongo).
 *
 * Passwords: the source `users.password` column is plaintext (confirmed by
 * both migrate.py's `# store plain text` comment and app.py's direct
 * string-equality login check). This script carries it over as-is, matching
 * the original app's storage/comparison behavior exactly.
 */
require("dotenv").config();
const { Client: PgClient } = require("pg");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const env = require("../src/config/env");
const {
  User,
  Record,
  Team,
  Project,
  Client,
  ActivityLog,
  Notification,
  CompletedLog,
  RequestLog,
  EditingLog,
  ensureAtLeast,
} = require("../src/models");
const { HOLD_IMAGES_DIR, ONHOLD_DIR } = require("../src/utils/fileStorage");

// Optional: source paths for hold-attachment files on the machine running this script.
// Override via env if the Flask app's BASE_DIR differs from these defaults.
const SRC_HOLD_IMAGES_DIR = process.env.PG_HOLD_IMAGES_DIR || "";
const SRC_ONHOLD_DIR = process.env.PG_ONHOLD_DIR || "";

async function main() {
  console.log("[MIGRATE] Connecting to Postgres…");
  const pg = new PgClient(env.pg);
  await pg.connect();

  console.log("[MIGRATE] Connecting to MongoDB…");
  await mongoose.connect(env.mongoUri);

  try {
    await migrateUsers(pg);
    await migrateMasterLists(pg);
    await migrateRecords(pg);
    await migrateCompletedLog(pg);
    await migrateNotifications(pg);
    await migrateEditingLog(pg);
    await migrateActivityLog(pg);
    await migrateRequestLog(pg);
    copyHoldFiles();
    await verify(pg);
    console.log("[MIGRATE] Done.");
  } finally {
    await pg.end();
    await mongoose.disconnect();
  }
}

async function migrateUsers(pg) {
  const { rows } = await pg.query("SELECT * FROM users");
  let count = 0;
  for (const r of rows) {
    await User.updateOne(
      { username: r.username },
      {
        username: r.username,
        password: r.password,
        role: r.role,
        allowedTeams: splitCsv(r.allowed_teams),
        crossTeam: !!r.cross_team,
        linkedTls: splitCsv(r.linked_tls),
        defaultTl: (r.default_tl || "").trim(),
        birthday: (r.birthday || "").trim(),
      },
      { upsert: true }
    );
    count++;
  }
  console.log(`[MIGRATE] users: ${count}`);
}

async function migrateMasterLists(pg) {
  for (const [table, Model] of [
    ["teams", Team],
    ["projects", Project],
    ["clients", Client],
  ]) {
    const { rows } = await pg.query(`SELECT name FROM ${table}`);
    for (const r of rows) {
      await Model.updateOne({ name: r.name }, { name: r.name }, { upsert: true });
    }
    console.log(`[MIGRATE] ${table}: ${rows.length}`);
  }
}

async function migrateRecords(pg) {
  const { rows } = await pg.query("SELECT * FROM records ORDER BY id ASC");
  const { rows: holdRows } = await pg.query("SELECT * FROM hold_data");
  const holdByRecordId = new Map(holdRows.map((h) => [String(h.record_id), h]));

  let maxId = 0;
  for (const r of rows) {
    maxId = Math.max(maxId, r.id);
    const hold = holdByRecordId.get(String(r.id));
    await Record.updateOne(
      { legacyId: r.id },
      {
        legacyId: r.id,
        project: r.project,
        submissionName: r.submission_name,
        client: r.client,
        submissionType: r.submission_type,
        team: r.team,
        subDate: r.sub_date,
        dueDate: r.due_date,
        remarks: r.remarks || "",
        status: r.status || "",
        createdAt: r.created_at || new Date(),
        completedAt: r.completed_at || null,
        createdBy: r.created_by || "",
        qaqc: r.qaqc || "",
        backComment: r.back_comment || "",
        furtherComment: r.further_comment || "",
        hold: hold
          ? {
              text: hold.hold_text || "",
              imageFilename: hold.image_filename || "",
              user: hold.hold_user || "",
              ts: hold.hold_ts || null,
            }
          : {},
      },
      { upsert: true }
    );
  }
  await ensureAtLeast("recordId", maxId);
  console.log(`[MIGRATE] records: ${rows.length} (legacy IDs preserved up to ${maxId})`);
}

async function migrateCompletedLog(pg) {
  const existing = await CompletedLog.countDocuments();
  if (existing > 0) {
    console.log("[MIGRATE] completed_log: skipped (already populated)");
    return;
  }
  const { rows } = await pg.query("SELECT * FROM completed_log ORDER BY id ASC");
  const docs = rows.map((r) => ({
    archivedAt: r.archived_at || new Date(),
    recordId: r.record_id,
    project: r.project || "",
    submissionName: r.submission_name || "",
    client: r.client || "",
    submissionType: r.submission_type || "",
    team: r.team || "",
    subDate: r.sub_date || "",
    dueDate: r.due_date || "",
    remarks: r.remarks || "",
    createdAt: r.created_at || "",
    completedAt: r.completed_at || "",
    createdBy: r.created_by || "",
    archivedBy: r.archived_by || "",
    qaqc: r.qaqc || "",
  }));
  if (docs.length) await CompletedLog.insertMany(docs);
  console.log(`[MIGRATE] completed_log: ${docs.length}`);
}

async function migrateNotifications(pg) {
  const { rows } = await pg.query("SELECT * FROM notifications");
  for (const r of rows) {
    await Notification.updateOne(
      { _id: r.id },
      {
        _id: r.id,
        ts: r.ts || new Date(),
        action: r.action || "",
        detail: r.detail || "",
        byUser: r.by_user || "",
        seenBy: splitCsv(r.seen_by),
      },
      { upsert: true }
    );
  }
  console.log(`[MIGRATE] notifications: ${rows.length}`);
}

async function migrateEditingLog(pg) {
  let rows = [];
  try {
    ({ rows } = await pg.query("SELECT * FROM editing_log ORDER BY id ASC"));
  } catch {
    console.log("[MIGRATE] editing_log: table not found, skipping");
    return;
  }
  const existing = await EditingLog.countDocuments();
  if (existing > 0) {
    console.log("[MIGRATE] editing_log: skipped (already populated)");
    return;
  }
  const docs = rows.map((r) => ({
    logId: r.log_id,
    uploadedAt: r.uploaded_at || new Date(),
    project: r.project,
    client: r.client,
    filename: r.filename || "",
    uploadedBy: r.uploaded_by || "",
    sheetName: r.sheet_name || "",
    sheetType: r.sheet_type || "Detail",
    detailedBy: r.detailed_by || "",
    checkedBy: r.checked_by || "",
    correctedBy: r.corrected_by || "",
    qcDone: r.qc_done || "",
    qcComment: r.qc_comment || "",
    remarks: r.remarks || "",
    detailedByDone: r.detailed_by_done || "0",
    checkedByDone: r.checked_by_done || "0",
    correctedByDone: r.corrected_by_done || "0",
    qcCommentDone: r.qc_comment_done || "0",
    allowedUsers: splitCsv(r.allowed_users),
  }));
  if (docs.length) await EditingLog.insertMany(docs);
  console.log(`[MIGRATE] editing_log: ${docs.length}`);
}

async function migrateActivityLog(pg) {
  const existing = await ActivityLog.countDocuments();
  if (existing > 0) {
    console.log("[MIGRATE] activity_log: skipped (already populated)");
    return;
  }
  const { rows } = await pg.query("SELECT * FROM activity_log ORDER BY id ASC");
  const docs = rows.map((r) => ({ ts: r.ts || new Date(), username: r.username || "", action: r.action || "", detail: r.detail || "" }));
  const BATCH = 5000;
  for (let i = 0; i < docs.length; i += BATCH) {
    await ActivityLog.insertMany(docs.slice(i, i + BATCH));
  }
  console.log(`[MIGRATE] activity_log: ${docs.length}`);
}

async function migrateRequestLog(pg) {
  const existing = await RequestLog.countDocuments();
  if (existing > 0) {
    console.log("[MIGRATE] request_log: skipped (already populated)");
    return;
  }
  const { rows } = await pg.query("SELECT * FROM request_log ORDER BY id ASC");
  const docs = rows.map((r) => ({
    ts: r.ts || new Date(),
    method: r.method || "",
    path: r.path || "",
    status: r.status || "",
    username: r.username || "",
    role: r.role || "",
    ip: r.ip || "",
    durationMs: r.duration_ms || 0,
    userAgent: r.user_agent || "",
  }));
  const BATCH = 5000;
  for (let i = 0; i < docs.length; i += BATCH) {
    await RequestLog.insertMany(docs.slice(i, i + BATCH));
  }
  console.log(`[MIGRATE] request_log: ${docs.length}`);
}

function copyHoldFiles() {
  for (const [src, dest, label] of [
    [SRC_HOLD_IMAGES_DIR, HOLD_IMAGES_DIR, "hold_images"],
    [SRC_ONHOLD_DIR, ONHOLD_DIR, "onhold_attachments"],
  ]) {
    if (!src) {
      console.log(`[MIGRATE] ${label}: PG_${label.toUpperCase()}_DIR not set, skipping file copy`);
      continue;
    }
    if (!fs.existsSync(src)) {
      console.log(`[MIGRATE] ${label}: source path not found (${src}), skipping`);
      continue;
    }
    fs.cpSync(src, dest, { recursive: true, force: false });
    const n = fs.readdirSync(dest).length;
    console.log(`[MIGRATE] ${label}: copied, ${n} files now in ${dest}`);
  }
}

async function verify(pg) {
  console.log("\n[VERIFY] Row counts — Postgres vs MongoDB:");
  const checks = [
    ["users", "SELECT COUNT(*) FROM users", User],
    ["records", "SELECT COUNT(*) FROM records", Record],
    ["teams", "SELECT COUNT(*) FROM teams", Team],
    ["projects", "SELECT COUNT(*) FROM projects", Project],
    ["clients", "SELECT COUNT(*) FROM clients", Client],
    ["completed_log", "SELECT COUNT(*) FROM completed_log", CompletedLog],
  ];
  for (const [label, sql, Model] of checks) {
    const pgCount = parseInt((await pg.query(sql)).rows[0].count, 10);
    const mongoCount = await Model.countDocuments();
    const flag = pgCount === mongoCount ? "OK" : "MISMATCH";
    console.log(`  ${label.padEnd(16)} pg=${pgCount} mongo=${mongoCount}  ${flag}`);
  }
}

function splitCsv(s) {
  return (s || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

main().catch((e) => {
  console.error("[MIGRATE ERROR]", e);
  process.exit(1);
});
