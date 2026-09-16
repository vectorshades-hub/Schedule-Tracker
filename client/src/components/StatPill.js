"use client";

/** The white rounded "stat pill" chip pattern reused across users/completed-log/
 * notifications/request-log/editing-log/drilldown pages. `color` tints only the number. */
export default function StatPill({ num, label, color, active, onClick }) {
  return (
    <div
      className={`stat-pill${onClick ? " clickable" : ""}${active ? " active" : ""}`}
      onClick={onClick}
    >
      <span className="sp-num" style={color ? { color } : undefined}>{num}</span>
      <span className="sp-lbl">{label}</span>
    </div>
  );
}
