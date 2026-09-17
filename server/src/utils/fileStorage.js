const fs = require("fs");
const path = require("path");
const env = require("../config/env");

// Single canonical folder for every hold image (add, standalone edit, and the
// record-edit "put on hold" flow all used to write to one of two different
// folders — hold_images vs onhold_attachments — depending on which route
// handled the request. That split was purely historical, nothing relied on
// them being separate, and it's what caused images saved under one name to
// 404/ENOENT when a different route later looked for them under the other.
const HOLD_IMAGES_DIR = path.join(env.uploadDir, "hold_images");
const LEGACY_ONHOLD_DIR = path.join(env.uploadDir, "onhold_attachments");
const PROJECT_IMAGES_DIR = path.join(env.uploadDir, "project_images");

fs.mkdirSync(HOLD_IMAGES_DIR, { recursive: true });
fs.mkdirSync(PROJECT_IMAGES_DIR, { recursive: true });
fs.mkdirSync(env.backupDir, { recursive: true });

// One-time migration: fold any files left over in the old onhold_attachments
// folder into hold_images, then remove it — idempotent (no-op once it's gone
// or empty), and safe (filenames are already `${recordId}_${timestamp}_...`
// so a name collision between the two folders isn't realistically possible).
if (fs.existsSync(LEGACY_ONHOLD_DIR)) {
  for (const name of fs.readdirSync(LEGACY_ONHOLD_DIR)) {
    const from = path.join(LEGACY_ONHOLD_DIR, name);
    const to = path.join(HOLD_IMAGES_DIR, name);
    try {
      if (!fs.existsSync(to)) fs.renameSync(from, to);
    } catch (e) {
      console.error("[fileStorage] failed migrating", from, e.message);
    }
  }
  try {
    fs.rmdirSync(LEGACY_ONHOLD_DIR);
  } catch {
    // not empty (a migration above failed) or already gone — leave it, harmless either way
  }
}

/** Same sanitization as app.py: re.sub(r"[^a-zA-Z0-9._-]","_", filename). */
function sanitizeFilename(name) {
  return String(name || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function timestampTag() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

/** Builds `${recordId}_${timestamp}_${safeName}` and writes the buffer to `dir`. Returns the filename. */
function saveUploadedFile(dir, recordId, originalName, buffer) {
  const safe = sanitizeFilename(originalName);
  const filename = `${recordId}_${timestampTag()}_${safe}`;
  fs.mkdirSync(dir, { recursive: true }); // defensive — recreate if it was deleted out from under a running server
  fs.writeFileSync(path.join(dir, filename), buffer);
  return filename;
}

function resolveHoldImagePath(filename) {
  if (!filename) return null;
  const safe = sanitizeFilename(filename);
  const p = path.join(HOLD_IMAGES_DIR, safe);
  return fs.existsSync(p) ? p : null;
}

/** Deletes a hold image by filename, if it exists. Safe to call with an empty/unknown filename. */
function deleteHoldImage(filename) {
  const resolved = resolveHoldImagePath(filename);
  if (!resolved) return;
  try {
    fs.unlinkSync(resolved);
  } catch (e) {
    console.error("[fileStorage] failed deleting", resolved, e.message);
  }
}

function resolveProjectImagePath(filename) {
  if (!filename) return null;
  const safe = sanitizeFilename(filename);
  const p = path.join(PROJECT_IMAGES_DIR, safe);
  return fs.existsSync(p) ? p : null;
}

/** Deletes a project image by filename, if it exists. Safe to call with an empty/unknown filename. */
function deleteProjectImage(filename) {
  const resolved = resolveProjectImagePath(filename);
  if (!resolved) return;
  try {
    fs.unlinkSync(resolved);
  } catch (e) {
    console.error("[fileStorage] failed deleting", resolved, e.message);
  }
}

module.exports = {
  HOLD_IMAGES_DIR,
  PROJECT_IMAGES_DIR,
  sanitizeFilename,
  saveUploadedFile,
  resolveHoldImagePath,
  deleteHoldImage,
  resolveProjectImagePath,
  deleteProjectImage,
};
