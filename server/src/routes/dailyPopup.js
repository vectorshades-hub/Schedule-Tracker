const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const { requireAuth } = require("../middleware/auth");
const { loadRecords } = require("../services/recordVisibility");
const statusEngine = require("../services/statusEngine");

const router = createSafeRouter();

/**
 * GET /api/daily-popup — upcoming/overdue due-date summary. Ported verbatim,
 * including the original's quirk of loading non-admin/management roles
 * under "team_lead" visibility rules for this endpoint specifically
 * (qaqc/user roles see team_lead-scoped results here, not their own role's
 * normal scoping — preserved as-is rather than "fixed", since it's a
 * narrow, low-risk cosmetic scope and changing it could silently alter who
 * sees what in the popup).
 */
router.get("/", requireAuth, async (req, res) => {
  const { username, role } = req.session;
  const today = statusEngine.todayUTC();
  const cutoff = new Date(today.getTime() + 3 * 86400000);

  const effectiveRole = ["admin", "management"].includes(role) ? "admin" : "team_lead";
  const allRecords = await loadRecords(username, effectiveRole);

  const upcoming = [];
  for (const r of allRecords) {
    if (["completed", "completed_overdue", "hold"].includes(r.tag)) continue;
    if (String(r.status || "").toUpperCase().startsWith("COMPLETED")) continue;
    const dueRaw = (r.due_date_raw || "").trim();
    if (!dueRaw) continue;
    const dueDt = statusEngine.parseDate(dueRaw);
    if (!dueDt) continue;
    if (dueDt.getTime() <= cutoff.getTime()) {
      const daysLeft = statusEngine.daysBetween(dueDt, today);
      upcoming.push({
        project: r.project,
        submission: r.submission_name,
        client: r.client,
        team: r.team,
        due_date: r.due_date,
        days_left: daysLeft,
      });
    }
  }
  upcoming.sort((a, b) => a.days_left - b.days_left);

  res.json({ records: upcoming, today: statusEngine.fmtDateOnlyISO(today), role, show_popup: true });
});

module.exports = router;
