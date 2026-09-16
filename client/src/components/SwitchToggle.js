"use client";

/** On/off switch — on = "Yes", off = anything else ("No" or unset). Used for
 * QA Done, Billable, and Invoice Released (records dashboard + completed log). */
export default function SwitchToggle({ value, disabled, onChange, label = "this field", requestConfirm }) {
  const on = value === "Yes";
  function toggle() {
    if (disabled) return;
    const next = on ? "No" : "Yes";
    if (requestConfirm) requestConfirm(label, next, () => onChange(next));
    else onChange(next);
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch-toggle${on ? " on" : ""}`}
      disabled={disabled}
      onClick={toggle}
    >
      <span className="switch-thumb" />
    </button>
  );
}
