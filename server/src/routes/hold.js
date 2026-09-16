const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const path = require("path");
const { Record } = require("../models");
const { requireAuth } = require("../middleware/auth");
const upload = require("../middleware/upload");
const { HOLD_IMAGES_DIR, saveUploadedFile, resolveHoldImagePath, deleteHoldImage } = require("../utils/fileStorage");
const env = require("../config/env");

const router = createSafeRouter();

/** POST /api/hold/save — multipart: record_id, hold_text, optional hold_image file, optional remove_image=1. */
router.post("/save", requireAuth, upload.single("hold_image"), async (req, res) => {
  const user = req.session.username;
  const recordId = String(req.body.record_id || "").trim();
  const holdText = String(req.body.hold_text || "").trim();
  const removeImg = req.body.remove_image === "1";

  let imgFn = "";
  if (!removeImg && req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!env.allowedImageExts.includes(ext)) {
      return res.json({ ok: false, error: "Invalid image type" });
    }
    imgFn = saveUploadedFile(HOLD_IMAGES_DIR, recordId, req.file.originalname, req.file.buffer);
  }

  try {
    const record = await Record.findOne({ legacyId: recordId });
    if (!record) return res.json({ ok: false, error: "Record not found" });
    const prevImgFn = record.hold?.imageFilename || "";

    if (removeImg) {
      record.hold = { ...(record.hold?.toObject?.() || record.hold || {}), imageFilename: "" };
    } else {
      record.hold = {
        text: holdText,
        imageFilename: imgFn || prevImgFn,
        user,
        ts: new Date(),
      };
    }
    await record.save();

    // Clean up the old file only once the new state is safely persisted —
    // either it was explicitly removed, or a fresh upload replaced it.
    if (prevImgFn && (removeImg || (imgFn && imgFn !== prevImgFn))) deleteHoldImage(prevImgFn);

    res.json({ ok: true, image_filename: imgFn || null });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/** GET /api/hold/image/:filename — authenticated file serve. Registered before /:recordId so it isn't shadowed. */
router.get("/image/:filename", requireAuth, (req, res) => {
  const resolved = resolveHoldImagePath(req.params.filename);
  if (!resolved) return res.status(404).json({ ok: false, error: "Not found" });
  res.sendFile(path.resolve(resolved));
});

/** GET /api/hold/:recordId */
router.get("/:recordId", requireAuth, async (req, res) => {
  const record = await Record.findOne({ legacyId: req.params.recordId }).lean();
  if (!record || !record.hold) return res.json({});
  res.json({
    text: record.hold.text || "",
    image_filename: record.hold.imageFilename || "",
    ts: record.hold.ts ? new Date(record.hold.ts).toISOString() : "",
    user: record.hold.user || "",
  });
});

/** POST /api/hold/:recordId/delete */
router.post("/:recordId/delete", requireAuth, async (req, res) => {
  const before = await Record.findOneAndUpdate({ legacyId: req.params.recordId }, { hold: {} });
  if (before?.hold?.imageFilename) deleteHoldImage(before.hold.imageFilename);
  res.json({ ok: true });
});

module.exports = router;
