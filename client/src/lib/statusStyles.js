// Ported 1:1 from base.html's `.badge-*` / `tr.*` CSS. Every record `tag` value maps to
// a badge color and a full-row tint — this is the single source of truth for the React port.
export const STATUS_STYLES = {
  overdue: { badgeBg: "#e74c3c", badgeFg: "#fff", rowBg: "#ffe5e5" },
  duesoon: { badgeBg: "#e67e22", badgeFg: "#fff", rowBg: "#fff3e0" },
  ontrack: { badgeBg: "#27ae60", badgeFg: "#fff", rowBg: "#e8f8ee" },
  completed: { badgeBg: "#3498db", badgeFg: "#fff", rowBg: "#e3f2fd" },
  completed_overdue: { badgeBg: "#135d8f", badgeFg: "#fff", rowBg: "#d7efff" },
  nodue: { badgeBg: "#95a5a6", badgeFg: "#fff", rowBg: "#f5f5f5" },
  hold: { badgeBg: "#7c3aed", badgeFg: "#fff", rowBg: "#f3e8ff" },
  invalid: { badgeBg: "#6c757d", badgeFg: "#fff", rowBg: "#f5f5f5" },
};

export const ROLE_BADGE_STYLES = {
  admin: { bg: "#ffc107", fg: "#000" },
  management: { bg: "#0dcaf0", fg: "#000" },
  team_lead: { bg: "#198754", fg: "#fff" },
  qaqc: { bg: "#7c3aed", fg: "#fff" },
  user: { bg: "#6c757d", fg: "#fff" },
};

export function statusStyle(tag) {
  return STATUS_STYLES[tag] || STATUS_STYLES.nodue;
}
