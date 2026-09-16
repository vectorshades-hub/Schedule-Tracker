const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");

/**
 * express.Router(), but every handler/middleware passed to .get/.post/.put/.delete/.patch
 * is automatically wrapped in asyncHandler. Wrapping non-async middleware (e.g. requireAuth)
 * this way is harmless — Promise.resolve(undefined) just resolves immediately.
 *
 * Use this instead of express.Router() in every routes file so a single unhandled async
 * rejection (a Mongoose CastError from a malformed id, a DB hiccup, etc.) can never crash
 * the whole process again — it becomes a normal 500 JSON response via app.js's error
 * middleware instead. See middleware/asyncHandler.js for the incident that motivated this.
 */
function createSafeRouter() {
  const router = express.Router();
  for (const method of ["get", "post", "put", "delete", "patch"]) {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) => original(path, ...handlers.map((h) => (typeof h === "function" ? asyncHandler(h) : h)));
  }
  return router;
}

module.exports = createSafeRouter;
