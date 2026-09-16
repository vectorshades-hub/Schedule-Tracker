const multer = require("multer");

// Memory storage everywhere — file bytes are written to disk (hold images)
// or parsed straight from the buffer (Excel imports) by the route handler,
// which controls the final filename. Matches the original's pattern of
// building a sanitized, ID-prefixed filename before saving.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB, generous for Excel/images
});

module.exports = upload;
