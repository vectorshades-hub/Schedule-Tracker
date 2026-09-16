const { Settings } = require("../models");

/** Finds the singleton settings doc, creating it (with defaults) on first use. */
async function getSettings() {
  let doc = await Settings.findById("app").lean();
  if (!doc) {
    doc = await Settings.create({ _id: "app" });
    doc = doc.toObject();
  }
  return doc;
}

/**
 * Every list below (invoiceReleaseEditors/recordUpdaters/recordDeleters) is
 * stored as an array of User `_id`s, not usernames — deliberately, so that
 * renaming a user (Settings > Users lets an admin change `username` freely)
 * can never silently drop a permission that was granted to them. `userId`
 * here should be the caller's *current* id (e.g. req.session.userId, set at
 * login — see middleware/auth.js — or a freshly-fetched user doc's `_id`).
 */
function hasId(list, userId) {
  if (!userId) return false;
  const target = String(userId);
  return (list || []).some((id) => String(id) === target);
}

/** Admins can always edit Invoice Released; everyone else needs to be on the configured list. */
async function canEditInvoiceReleased(userId, role) {
  if (role === "admin") return true;
  const settings = await getSettings();
  return hasId(settings.invoiceReleaseEditors, userId);
}

/** Admins can always update records; everyone else needs to be on the configured list
 * (Settings page) — replaces the old shared "update password" gate. */
async function canUpdateRecords(userId, role) {
  if (role === "admin") return true;
  const settings = await getSettings();
  return hasId(settings.recordUpdaters, userId);
}

/** Admins can always delete records; everyone else needs to be on the configured list
 * (Settings page) — replaces the old shared "delete password" gate. */
async function canDeleteRecords(userId, role) {
  if (role === "admin") return true;
  const settings = await getSettings();
  return hasId(settings.recordDeleters, userId);
}

/** Admins can always delete Change Orders; everyone else needs to be on the configured
 * list (Settings page) — replaces the old shared "delete password" gate. */
async function canDeleteChangeOrders(userId, role) {
  if (role === "admin") return true;
  const settings = await getSettings();
  return hasId(settings.coDeleters, userId);
}

/** Admins can always delete RFIs; everyone else needs to be on the configured list
 * (Settings page) — replaces the old shared "delete password" gate. */
async function canDeleteRfis(userId, role) {
  if (role === "admin") return true;
  const settings = await getSettings();
  return hasId(settings.rfiDeleters, userId);
}

/** Admins can always edit the Completed Log; everyone else needs to be on the configured
 * list (Settings page). */
async function canEditCompletedLog(userId, role) {
  if (role === "admin") return true;
  const settings = await getSettings();
  return hasId(settings.completedLogEditors, userId);
}

/**
 * Management Dashboard visibility: admins and management always get in;
 * anyone else needs the "Invoice Released" edit permission (Settings page)
 * — the dashboard's whole point is acting on that field, so being allowed
 * to edit it elsewhere already implies needing to see it here.
 */
async function canViewManagementDashboard(userId, role) {
  if (role === "admin" || role === "management") return true;
  return canEditInvoiceReleased(userId, role);
}

module.exports = {
  getSettings,
  canEditInvoiceReleased,
  canUpdateRecords,
  canDeleteRecords,
  canDeleteChangeOrders,
  canDeleteRfis,
  canEditCompletedLog,
  canViewManagementDashboard,
};
