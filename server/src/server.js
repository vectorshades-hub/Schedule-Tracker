const app = require("./app");
const env = require("./config/env");
const { connectDB } = require("./config/db");
const { startBackupScheduler } = require("./services/backupJob");

// Defense-in-depth: every route is wrapped in asyncHandler (see middleware/asyncHandler.js)
// so request errors are handled per-request via Express's error middleware. These are a
// last-resort net for anything that still slips through (e.g. an error thrown from a
// fire-and-forget background task) — log it, don't take the whole server down.
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err);
});

async function main() {
  await connectDB();
  startBackupScheduler();
  app.listen(env.port, () => {
    console.log(`[SERVER] Schedule Tracker API listening on http://localhost:${env.port}`);
  });
}

main().catch((e) => {
  console.error("[FATAL] Failed to start server:", e);
  process.exit(1);
});
