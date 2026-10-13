/**
 * Whole-system backup — every MongoDB collection plus every uploaded file
 * (hold images, project images, ...) zipped into one archive. Unlike
 * backupJob.js's daily Excel export (records only, human-readable), this is
 * the "restore everything" snapshot.
 *
 * Archive layout:
 *   manifest.json            — when/who/what, per-collection doc counts
 *   db/<collection>.ndjson   — one canonical Extended JSON doc per line, so
 *                              ObjectIds/Dates round-trip exactly on restore
 *                              (mongoimport-compatible)
 *   files/<subdir>/...       — the upload folder, minus the backups folder itself
 *
 * Runs automatically every Sunday at 06:00 (server local time) and on demand
 * from the admin "⋮" menu. Only the newest `fullBackupKeep` archives are kept.
 * restoreFullBackup() reverses it (from a stored archive or an uploaded one).
 */
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const cron = require("node-cron");
const archiver = require("archiver");
const unzipper = require("unzipper");
const mongoose = require("mongoose");
const env = require("../config/env");
const { writeLog } = require("./logging");
const { HOLD_IMAGES_DIR, PROJECT_IMAGES_DIR } = require("../utils/fileStorage");

const { EJSON } = mongoose.mongo.BSON;
const FULL_BACKUP_DIR = path.join(env.backupDir, "full");
const FILE_RE = /^full_backup_\d{4}-\d{2}-\d{2}_\d{6}\.zip$/;
// Login sessions are transient and restoring them would resurrect old logins — leave them out.
const SKIP_COLLECTIONS = new Set(["sessions"]);

let running = null; // { kind: "backup" | "restore", promise } — only one job at a time

function stamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function* collectionLines(coll) {
  for await (const doc of coll.find({})) {
    yield EJSON.stringify(doc, { relaxed: false }) + "\n";
  }
}

async function buildArchive(filepath, { trigger, by }) {
  const db = mongoose.connection.db;
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !SKIP_COLLECTIONS.has(n) && !n.startsWith("system."))
    .sort();

  const counts = {};
  for (const name of collections) counts[name] = await db.collection(name).countDocuments();

  const out = fs.createWriteStream(filepath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    out.on("close", resolve);
    out.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (e) => console.warn("[FULL BACKUP] warning:", e.message));
  });
  archive.pipe(out);

  const manifest = { app: "schedule-tracker", createdAt: new Date().toISOString(), trigger, by, format: "ndjson-ejson-canonical", collections: counts };
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  for (const name of collections) {
    archive.append(Readable.from(collectionLines(db.collection(name))), { name: `db/${name}.ndjson` });
  }

  const backupRoot = path.resolve(env.backupDir);
  if (fs.existsSync(env.uploadDir)) {
    for (const entry of fs.readdirSync(env.uploadDir, { withFileTypes: true })) {
      const full = path.resolve(env.uploadDir, entry.name);
      if (full === backupRoot || backupRoot.startsWith(full + path.sep)) continue; // never zip backups into backups
      if (entry.isDirectory()) archive.directory(full, `files/${entry.name}`);
      else if (entry.isFile()) archive.file(full, { name: `files/${entry.name}` });
    }
  }

  await archive.finalize();
  await done;
}

function pruneOldBackups() {
  const files = listFullBackups();
  for (const f of files.slice(env.fullBackupKeep)) {
    try {
      fs.unlinkSync(path.join(FULL_BACKUP_DIR, f.name));
    } catch (e) {
      console.error("[FULL BACKUP] failed pruning", f.name, e.message);
    }
  }
}

/** Newest first: [{ name, size, createdAt }] */
function listFullBackups() {
  let names;
  try {
    names = fs.readdirSync(FULL_BACKUP_DIR);
  } catch {
    return [];
  }
  return names
    .filter((n) => FILE_RE.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(FULL_BACKUP_DIR, name));
      return { name, size: st.size, createdAt: st.mtime };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Resolves a user-supplied backup name to its path, or null — guards against path traversal. */
function resolveFullBackup(name) {
  if (!FILE_RE.test(String(name || ""))) return null;
  const p = path.join(FULL_BACKUP_DIR, name);
  return fs.existsSync(p) ? p : null;
}

/**
 * Writes one archive. Written under a .partial name and renamed on success,
 * so a crash mid-backup never leaves a truncated zip that looks valid.
 * No locking/pruning — callers (createFullBackup, restoreFullBackup) own that.
 */
async function writeBackup({ trigger, by }) {
  fs.mkdirSync(FULL_BACKUP_DIR, { recursive: true });
  const name = `full_backup_${stamp()}.zip`;
  const finalPath = path.join(FULL_BACKUP_DIR, name);
  const tmpPath = `${finalPath}.partial`;
  try {
    await buildArchive(tmpPath, { trigger, by });
    fs.renameSync(tmpPath, finalPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw e;
  }
  const { size } = fs.statSync(finalPath);
  console.log(`[FULL BACKUP] Created ${finalPath} (${size} bytes, ${trigger})`);
  writeLog("FULL BACKUP", `${name} (${trigger})`, by);
  return { name, size, createdAt: new Date() };
}

/** User-facing failure (bad file, busy, ...) — routes turn these into a 400/409 with the message. */
class BackupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function withLock(kind, fn) {
  running = { kind, promise: fn().finally(() => { running = null; }) };
  return running.promise;
}

function createFullBackup({ trigger = "manual", by = "system" } = {}) {
  if (running?.kind === "backup") return running.promise; // a second request just waits on the same run
  if (running) return Promise.reject(new BackupError("A restore is in progress — try again once it finishes.", 409));
  return withLock("backup", async () => {
    const backup = await writeBackup({ trigger, by });
    pruneOldBackups();
    return backup;
  });
}

/**
 * Reads + validates the whole archive up front so a bad/foreign zip is
 * rejected before anything is touched. Returns parsed docs per collection and
 * the file entries to extract.
 */
async function readArchive(zipPath) {
  let dir;
  try {
    dir = await unzipper.Open.file(zipPath);
  } catch {
    throw new BackupError("That file is not a valid zip archive.");
  }
  const byPath = new Map(dir.files.map((f) => [f.path.replace(/\\/g, "/"), f]));

  const mf = byPath.get("manifest.json");
  let manifest;
  try {
    manifest = mf && JSON.parse((await mf.buffer()).toString("utf8"));
  } catch {}
  if (!manifest || manifest.app !== "schedule-tracker" || !manifest.collections) {
    throw new BackupError("That file is not a Schedule Tracker full backup.");
  }

  const collections = {};
  for (const name of Object.keys(manifest.collections)) {
    if (!/^[\w.-]+$/.test(name) || SKIP_COLLECTIONS.has(name) || name.startsWith("system.")) continue;
    const f = byPath.get(`db/${name}.ndjson`);
    if (!f) throw new BackupError(`Backup is incomplete — db/${name}.ndjson is missing.`);
    const lines = (await f.buffer()).toString("utf8").split("\n").filter(Boolean);
    try {
      collections[name] = lines.map((l) => EJSON.parse(l, { relaxed: false }));
    } catch {
      throw new BackupError(`Backup is corrupt — db/${name}.ndjson could not be parsed.`);
    }
  }

  const files = [];
  for (const f of dir.files) {
    const p = f.path.replace(/\\/g, "/");
    if (f.type !== "File" || !p.startsWith("files/")) continue;
    const rel = path.normalize(p.slice("files/".length));
    if (!rel || path.isAbsolute(rel) || rel.split(path.sep).includes("..")) {
      throw new BackupError(`Backup contains an unsafe file path: ${p}`);
    }
    files.push({ rel, entry: f });
  }

  return { manifest, collections, files };
}

async function restoreCollections(collections) {
  const db = mongoose.connection.db;
  for (const [name, docs] of Object.entries(collections)) {
    const coll = db.collection(name);
    await coll.deleteMany({});
    for (let i = 0; i < docs.length; i += 1000) {
      await coll.insertMany(docs.slice(i, i + 1000), { ordered: true });
    }
  }
}

/**
 * Swaps the upload folder's contents for the backup's: extract into a staging
 * folder first, then move current items aside, move staged ones in, and only
 * then delete the old ones. The backups folder itself is never touched.
 */
async function restoreFiles(files) {
  const uploadDir = path.resolve(env.uploadDir);
  const backupRoot = path.resolve(env.backupDir);
  const staging = path.join(uploadDir, `.restore_staging_${Date.now()}`);
  const old = path.join(uploadDir, `.restore_old_${Date.now()}`);
  fs.mkdirSync(staging, { recursive: true });

  try {
    for (const { rel, entry } of files) {
      const dest = path.join(staging, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await new Promise((resolve, reject) => {
        entry.stream().pipe(fs.createWriteStream(dest)).on("finish", resolve).on("error", reject);
      });
    }

    const isProtected = (full) => full === backupRoot || backupRoot.startsWith(full + path.sep) || full === staging || full === old;
    fs.mkdirSync(old, { recursive: true });
    for (const name of fs.readdirSync(uploadDir)) {
      const full = path.join(uploadDir, name);
      if (isProtected(full) || name.startsWith(".restore_")) continue;
      fs.renameSync(full, path.join(old, name));
    }
    for (const name of fs.readdirSync(staging)) {
      const target = path.join(uploadDir, name);
      if (isProtected(target)) continue;
      fs.renameSync(path.join(staging, name), target);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
  }
  // The app expects these to exist even if the backup had them empty (zip drops empty dirs).
  fs.mkdirSync(HOLD_IMAGES_DIR, { recursive: true });
  fs.mkdirSync(PROJECT_IMAGES_DIR, { recursive: true });
}

/**
 * Replaces every backed-up collection and the upload folder with the archive's
 * contents. A "pre-restore" backup of the current state is taken first, so a
 * restore can itself be undone by restoring that one. Login sessions are
 * excluded from backups, so everyone stays logged in.
 */
function restoreFullBackup(zipPath, { by, source }) {
  if (running) {
    return Promise.reject(new BackupError(`A ${running.kind} is already in progress — try again once it finishes.`, 409));
  }
  return withLock("restore", async () => {
    const { manifest, collections, files } = await readArchive(zipPath);
    const safety = await writeBackup({ trigger: "pre-restore", by });
    try {
      await restoreCollections(collections);
      await restoreFiles(files);
    } catch (e) {
      console.error("[FULL BACKUP] Restore failed:", e);
      throw new BackupError(`Restore failed part-way (${e.message}). Restore "${safety.name}" to get back to the state before this attempt.`, 500);
    }
    console.log(`[FULL BACKUP] Restored ${source} (taken ${manifest.createdAt}) by ${by}`);
    writeLog("FULL RESTORE", `${source} (backup taken ${manifest.createdAt}); pre-restore copy: ${safety.name}`, by);
    pruneOldBackups();
    return { restoredFrom: source, backupCreatedAt: manifest.createdAt, safetyBackup: safety.name };
  });
}

function startFullBackupScheduler() {
  // Every Sunday at 06:00, server local time.
  cron.schedule("0 6 * * 0", () => {
    createFullBackup({ trigger: "scheduled", by: "system" }).catch((e) => console.error("[FULL BACKUP] Failed:", e.message));
  });
}

module.exports = {
  BackupError,
  createFullBackup,
  restoreFullBackup,
  listFullBackups,
  resolveFullBackup,
  startFullBackupScheduler,
  currentJob: () => running?.kind || null,
};
