const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const { requireRole } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { writeLog } = require("../services/logging");
const { runBulkUpload, COLLECTIONS, buildSampleWorkbook } = require("../services/csvBulkUpload");

const router = createSafeRouter();

/** GET /api/bulk-upload/collections — admin only, list of uploadable collections + their expected column order. */
router.get("/collections", requireRole("admin"), (req, res) => {
  res.json({ collections: COLLECTIONS });
});

/** GET /api/bulk-upload/sample/:collection — admin only, downloadable .xlsx showing the expected column order + example rows. Save as CSV (no header row) before re-uploading. */
router.get("/sample/:collection", requireRole("admin"), async (req, res) => {
  const collection = String(req.params.collection || "").trim();
  if (!COLLECTIONS.some((c) => c.key === collection)) {
    return res.status(400).json({ ok: false, error: "Unknown collection." });
  }
  const wb = await buildSampleWorkbook(collection);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${collection}_sample.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

/** POST /api/bulk-upload — admin only. multipart: collection, file (CSV, no header row). */
router.post("/", requireRole("admin"), upload.single("file"), async (req, res) => {
  const collection = String(req.body.collection || "").trim();
  if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded." });
  if (!COLLECTIONS.some((c) => c.key === collection)) {
    return res.status(400).json({ ok: false, error: "Unknown collection." });
  }

  try {
    const result = await runBulkUpload(collection, req.file.buffer, req.session.username);
    writeLog(
      "BULK-UPLOAD",
      `collection=${collection} inserted=${result.inserted} updated=${result.updated} skipped=${result.skipped} errors=${result.errors.length}`,
      req.session.username
    );
    res.json({ ok: true, collection, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
