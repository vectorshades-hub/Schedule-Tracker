const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** 'MM-DD' -> 'DD-Mon' (e.g. '05-28' -> '28-May'). Ported from app.py's _bday_to_display. */
function bdayToDisplay(mmdd) {
  const m = String(mmdd || "").match(/^(\d{2})-(\d{2})$/);
  if (!m) return "";
  const mon = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  if (mon < 1 || mon > 12) return mmdd;
  return `${String(day).padStart(2, "0")}-${MONTH_ABBR[mon - 1]}`;
}

/** 'DD-Mon' / 'DD-Month' -> 'MM-DD'; passthrough if already 'MM-DD'. Ported from app.py's _bday_from_display. */
function bdayFromDisplay(s) {
  const str = String(s || "").trim();
  if (!str) return "";
  if (/^\d{2}-\d{2}$/.test(str)) return str; // already MM-DD
  const m = str.match(/^(\d{1,2})-([A-Za-z]+)$/);
  if (!m) return "";
  const day = parseInt(m[1], 10);
  const monStr = m[2].slice(0, 3).charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase();
  const idx = MONTH_ABBR.indexOf(monStr);
  if (idx === -1) return "";
  return `${String(idx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

module.exports = { MONTH_ABBR, bdayToDisplay, bdayFromDisplay };
