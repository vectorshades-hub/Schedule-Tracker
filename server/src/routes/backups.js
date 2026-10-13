const fs = require("fs");
const os = require("os");
const multer = require("multer");
const createSafeRouter = require("../utils/safeRouter");
const { requireRole } = require("../middleware/auth");
const { User } = require("../models");
const {
  BackupError,
  createFullBackup,
  restoreFullBackup,
  listFullBackups,
  resolveFullBackup,
  currentJob,
} = require("../services/fullBackup");

const router = createSafeRouter();

// Backups can be far larger than the app's 25MB in-memory upload limit — spool to a temp file instead.
const zipUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

function sendBackupError(res, e) {
  if (e instanceof BackupError) return res.status(e.status).json({ ok: false, error: e.message });
  throw e;
}

/** Restoring overwrites everything, so the admin re-enters their own login password to confirm. */
async function passwordMatches(req) {
  const user = await User.findById(req.session.userId).select("password").lean();
  return !!user && user.password === String(req.body.password || "").trim();
}

/** GET /api/backups — admin-only list of whole-system backup archives, newest first. */
router.get("/", requireRole("admin"), async (req, res) => {
  const job = currentJob();
  res.json({ ok: true, backups: listFullBackups(), running: job === "backup", restoring: job === "restore" });
});

/** POST /api/backups — take a whole-system backup now (waits for it to finish). */
router.post("/", requireRole("admin"), async (req, res) => {
  try {
    const backup = await createFullBackup({ trigger: "manual", by: req.session.username });
    res.json({ ok: true, backup });
  } catch (e) {
    sendBackupError(res, e);
  }
});

/** GET /api/backups/:name/download — stream one archive. */
router.get("/:name/download", requireRole("admin"), async (req, res) => {
  const p = resolveFullBackup(req.params.name);
  if (!p) return res.status(404).json({ ok: false, error: "Backup not found" });
  res.download(p, req.params.name);
});

/** POST /api/backups/:name/restore — { password }. Restore from a stored archive. */
router.post("/:name/restore", requireRole("admin"), async (req, res) => {
  const p = resolveFullBackup(req.params.name);
  if (!p) return res.status(404).json({ ok: false, error: "Backup not found" });
  if (!(await passwordMatches(req))) return res.status(403).json({ ok: false, error: "Incorrect password." });
  try {
    const result = await restoreFullBackup(p, { by: req.session.username, source: req.params.name });
    res.json({ ok: true, ...result });
  } catch (e) {
    sendBackupError(res, e);
  }
});

/** POST /api/backups/restore-upload — multipart { file, password }. Restore from an uploaded archive. */
router.post("/restore-upload", requireRole("admin"), zipUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "Choose a backup .zip file." });
    if (!(await passwordMatches(req))) return res.status(403).json({ ok: false, error: "Incorrect password." });
    const result = await restoreFullBackup(req.file.path, { by: req.session.username, source: `uploaded file ${req.file.originalname}` });
    res.json({ ok: true, ...result });
  } catch (e) {
    sendBackupError(res, e);
  } finally {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
  }
});

module.exports = router;
