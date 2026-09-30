// Mirrors OWN_EDIT_WINDOW_MS in server/src/routes/records.js — the server is
// the authority; this only decides whether to show the Edit button.
const OWN_EDIT_WINDOW_MS = 60 * 60 * 1000;

/** Global "update records" permission, or within one hour of the record's creation time. */
export function canEditRecord(user, record) {
  if (user?.can_update_records) return true;
  if (!user || !record?.created_at_raw) return false;
  const age = Date.now() - new Date(record.created_at_raw).getTime();
  return age >= 0 && age < OWN_EDIT_WINDOW_MS;
}
