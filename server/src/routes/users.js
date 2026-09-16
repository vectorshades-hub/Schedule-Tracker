const express = require("express");
const createSafeRouter = require("../utils/safeRouter");
const ExcelJS = require("exceljs");
const { User } = require("../models");
const { requireRole } = require("../middleware/auth");
const { writeLog } = require("../services/logging");
const { bdayToDisplay, bdayFromDisplay } = require("../utils/birthday");
const upload = require("../middleware/upload");

const router = createSafeRouter();

const VALID_ROLES = ["admin", "team_lead", "management", "qaqc", "user"];
const ROLE_ORDER = { admin: 0, management: 1, team_lead: 2, qaqc: 3, user: 4 };

function toClient(u) {
  return {
    username: u.username,
    role: u.role,
    allowed_teams: u.allowedTeams || [],
    cross_team: !!u.crossTeam,
    linked_tls: u.linkedTls || [],
    default_tl: u.defaultTl || "",
    birthday: u.birthday || "",
  };
}

/** GET /api/users — admin only, sorted like users.html (role_order, then username). */
router.get("/", requireRole("admin"), async (req, res) => {
  const users = await User.find({}).lean();
  users.sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? 99;
    const rb = ROLE_ORDER[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.username.toLowerCase().localeCompare(b.username.toLowerCase());
  });
  res.json({ users: users.map(toClient) });
});

/** POST /api/users — add a user (admin only). */
router.post("/", requireRole("admin"), async (req, res) => {
  const b = req.body;
  const username = String(b.new_username || "").trim();
  const password = String(b.new_password || "").trim();
  const confirm = String(b.confirm_password || "").trim();
  const role = String(b.new_role || "team_lead").trim();

  if (!username || !password) return res.status(400).json({ ok: false, error: "Username and password are required." });
  if (password !== confirm) return res.status(400).json({ ok: false, error: "Passwords do not match." });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ ok: false, error: "Invalid role." });

  const existing = await User.findOne({ username: new RegExp(`^${username}$`, "i") });
  if (existing) return res.status(409).json({ ok: false, error: `Username '${username}' already exists.` });

  let allowedTeams = [],
    crossTeam = false,
    linkedTls = [],
    defaultTl = "";
  if (role === "management") {
    allowedTeams = arrify(b.allowed_teams_chk);
    crossTeam = b.cross_team === "1";
  } else if (role === "user" || role === "qaqc") {
    linkedTls = arrify(b.linked_tls_chk);
    if (role === "qaqc") defaultTl = String(b.default_tl_radio || "").trim();
  }
  const birthday = b.bday_month && b.bday_day ? `${b.bday_month}-${b.bday_day}` : "";

  await User.create({ username, password, role, allowedTeams, crossTeam, linkedTls, defaultTl, birthday });
  writeLog("ADD-USER", `User '${username}' role=${role}`, req.session.username);
  res.json({ ok: true, message: `User '${username}' added successfully.` });
});

/** PUT /api/users/:username — edit (admin only). */
router.put("/:username", requireRole("admin"), async (req, res) => {
  const oldUsername = req.params.username;
  const b = req.body;
  const newUsername = String(b.edit_username || "").trim();
  const newPassword = String(b.edit_password || "").trim();
  const newRole = String(b.edit_role || "").trim();

  if (!newUsername || !VALID_ROLES.includes(newRole)) {
    return res.status(400).json({ ok: false, error: "Invalid input." });
  }

  const existing = await User.findOne({ username: oldUsername });
  if (!existing) return res.status(404).json({ ok: false, error: "User not found." });

  if (newUsername.toLowerCase() !== oldUsername.toLowerCase()) {
    const clash = await User.findOne({ username: new RegExp(`^${newUsername}$`, "i") });
    if (clash) return res.status(409).json({ ok: false, error: `Username '${newUsername}' already exists.` });
  }

  let allowedTeams = [],
    crossTeam = false,
    linkedTls = [],
    defaultTl = "";
  if (newRole === "management") {
    allowedTeams = arrify(b.allowed_teams_chk);
    crossTeam = b.cross_team === "1";
  } else if (newRole === "user" || newRole === "qaqc") {
    linkedTls = arrify(b.linked_tls_chk);
    if (newRole === "qaqc") defaultTl = String(b.default_tl_radio || "").trim();
  }
  const birthday = b.bday_month && b.bday_day ? `${b.bday_month}-${b.bday_day}` : "";

  existing.username = newUsername;
  existing.role = newRole;
  existing.allowedTeams = allowedTeams;
  existing.crossTeam = crossTeam;
  existing.linkedTls = linkedTls;
  existing.defaultTl = defaultTl;
  existing.birthday = birthday;
  if (newPassword) existing.password = newPassword;
  await existing.save();

  // Keep the current session in sync if the admin renamed/re-roled themselves.
  if (req.session.username === oldUsername) {
    req.session.username = newUsername;
    req.session.role = newRole;
  }

  writeLog("EDIT-USER", `'${oldUsername}'→'${newUsername}' role=${newRole}`, req.session.username);
  res.json({ ok: true, message: `User '${newUsername}' updated.` });
});

/** DELETE /api/users/:username — admin only, no self-delete. */
router.delete("/:username", requireRole("admin"), async (req, res) => {
  const username = req.params.username;
  if (username === req.session.username) {
    return res.status(400).json({ ok: false, error: "You cannot delete your own account." });
  }
  await User.deleteOne({ username });
  writeLog("DEL-USER", `User '${username}' deleted`, req.session.username);
  res.json({ ok: true, message: `User '${username}' deleted.` });
});

/** POST /api/users/bulk-birthday — admin only. Body: { bulk_data: "username,MM-DD\n..." }. */
router.post("/bulk-birthday", requireRole("admin"), async (req, res) => {
  const raw = String(req.body.bulk_data || "");
  const users = await User.find({}).select("username").lean();
  const known = new Set(users.map((u) => u.username));

  let updated = 0,
    skippedFmt = 0,
    skippedUser = 0;
  const updatedPairs = [];

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const commaIdx = line.indexOf(",");
    if (commaIdx === -1) {
      skippedFmt++;
      continue;
    }
    const username = line.slice(0, commaIdx).trim();
    const bday = line.slice(commaIdx + 1).trim();
    if (!username) {
      skippedFmt++;
      continue;
    }
    if (username.toLowerCase() === "username") continue; // header row
    if (!known.has(username)) {
      skippedUser++;
      continue;
    }
    if (bday && !/^\d{2}-\d{2}$/.test(bday)) {
      skippedFmt++;
      continue;
    }
    if (bday) {
      const [mm, dd] = bday.split("-").map(Number);
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
        skippedFmt++;
        continue;
      }
    }
    await User.updateOne({ username }, { birthday: bday });
    updated++;
    updatedPairs.push(`${username}:${bday || "(cleared)"}`);
  }

  const logDetail = updatedPairs.slice(0, 10).join(", ") + (updatedPairs.length > 10 ? " …" : "");
  writeLog("BULK-BIRTHDAY", logDetail, req.session.username);

  res.json({ ok: updated > 0, updated, skipped_fmt: skippedFmt, skipped_user: skippedUser });
});

/** GET /api/users/export — admin only, passwords always blank. */
router.get("/export", requireRole("admin"), async (req, res) => {
  const users = await User.find({}).sort({ username: 1 }).lean();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Users");
  const headers = ["Username", "Password", "Role", "Allowed Teams", "Cross Team", "Linked TLs", "Default TL", "Birthday"];
  ws.addRow(headers);
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F3D2E" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { horizontal: "center" };
  });

  for (const u of users) {
    const row = ws.addRow([
      u.username,
      "", // passwords are never exported (matches the original app.py); blank = keep existing on re-import
      u.role,
      (u.allowedTeams || []).join(","),
      u.crossTeam ? "Yes" : "No",
      (u.linkedTls || []).join(","),
      u.defaultTl || "",
      bdayToDisplay(u.birthday || ""),
    ]);
    row.getCell(8).numFmt = "@"; // force text format so Excel doesn't auto-convert "28-May" to a date serial
  }

  ws.columns.forEach((col) => {
    let maxLen = 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      maxLen = Math.max(maxLen, String(cell.value ?? "").length);
    });
    col.width = Math.min(Math.max(maxLen + 2, 14), 45);
  });

  writeLog("EXPORT-USERS", `Exported ${users.length} users`, req.session.username);

  const ts = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const filename = `users_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(
    ts.getMinutes()
  )}${pad(ts.getSeconds())}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

/** POST /api/users/import — admin only, .xlsx, update-only (never creates users). */
router.post("/import", requireRole("admin"), upload.single("users_file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded." });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const ws = wb.worksheets[0];

  const existingUsers = await User.find({}).lean();
  const byLower = new Map(existingUsers.map((u) => [u.username.toLowerCase(), u]));

  let updated = 0,
    skippedUser = 0,
    skippedInvalid = 0;
  const updatedNames = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const get = (i) => (row.getCell(i).value ?? "").toString().trim();
    const username = get(1);
    if (!username || !byLower.has(username.toLowerCase())) {
      skippedUser++;
      return;
    }
    const existing = byLower.get(username.toLowerCase());
    const password = get(2);
    const role = get(3);
    const allowedTeamsRaw = get(4);
    const crossTeamRaw = get(5).toLowerCase();
    const linkedTlsRaw = get(6);
    const defaultTl = get(7);
    const bdayCell = row.getCell(8).value;

    if (role && !VALID_ROLES.includes(role)) {
      skippedInvalid++;
      return;
    }

    const update = {};
    if (password) update.password = password;
    if (role) update.role = role;
    if (allowedTeamsRaw) update.allowedTeams = allowedTeamsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    update.crossTeam = ["yes", "true", "1", "y"].includes(crossTeamRaw);
    if (linkedTlsRaw) update.linkedTls = linkedTlsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    if (defaultTl) update.defaultTl = defaultTl;

    let birthday = "";
    if (bdayCell && typeof bdayCell === "object" && bdayCell.getMonth) {
      // openpyxl/exceljs auto-converted the text cell to a real Date
      birthday = `${String(bdayCell.getMonth() + 1).padStart(2, "0")}-${String(bdayCell.getDate()).padStart(2, "0")}`;
    } else if (bdayCell) {
      birthday = bdayFromDisplay(String(bdayCell).trim());
    }
    if (birthday) update.birthday = birthday;

    existing.__pending = update;
    updated++;
    updatedNames.push(username);
  });

  for (const [, u] of byLower) {
    if (!u.__pending) continue;
    await User.updateOne({ username: u.username }, u.__pending);
  }

  const logDetail = updatedNames.slice(0, 10).join(", ") + (updatedNames.length > 10 ? " …" : "");
  writeLog("IMPORT-USERS", logDetail, req.session.username);

  res.json({ ok: true, updated, skipped_user: skippedUser, skipped_invalid: skippedInvalid });
});

function arrify(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return [String(v).trim()].filter(Boolean);
}

module.exports = router;
