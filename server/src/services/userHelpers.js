const { User } = require("../models");

/** Team-lead/management usernames — used to populate team pickers. */
async function getTeamsFromUsers() {
  const rows = await User.find({ role: { $in: ["team_lead", "management"] } })
    .sort({ username: 1 })
    .select("username")
    .lean();
  return rows.map((r) => r.username);
}

async function getAllowedTeamsForUser(username) {
  const u = await User.findOne({ username }).select("allowedTeams").lean();
  return u ? u.allowedTeams || [] : [];
}

async function getLinkedTls(username) {
  const u = await User.findOne({ username }).select("linkedTls").lean();
  return u ? u.linkedTls || [] : [];
}

async function getDefaultTl(username) {
  const u = await User.findOne({ username }).select("defaultTl").lean();
  return u ? u.defaultTl || "" : "";
}

/** Cross-team management users who have this team_lead in their allowed_teams (or have none set = all). */
async function getManagementUsersForTeamlead(tlUsername) {
  const rows = await User.find({ role: "management", crossTeam: true })
    .select("username allowedTeams")
    .lean();
  const result = [];
  for (const row of rows) {
    const allowed = row.allowedTeams || [];
    if (!allowed.length || allowed.includes(tlUsername)) result.push(row.username);
  }
  return result;
}

async function getAllTeamleadsInManagement(mgmtUsername) {
  const mgmt = await User.findOne({ username: mgmtUsername, role: "management" })
    .select("allowedTeams")
    .lean();
  if (!mgmt) return [];
  const allowed = mgmt.allowedTeams || [];
  const tls = await User.find({ role: "team_lead" }).select("username").lean();
  const allTls = tls.map((t) => t.username);
  return allTls.filter((t) => !allowed.length || allowed.includes(t));
}

module.exports = {
  getTeamsFromUsers,
  getAllowedTeamsForUser,
  getLinkedTls,
  getDefaultTl,
  getManagementUsersForTeamlead,
  getAllTeamleadsInManagement,
};
