"use client";
import { useEffect, useRef, useState } from "react";

/**
 * One reusable searchable-dropdown implementation, replacing the 3+ near-identical
 * vanilla-JS copies scattered across login.html / index.html / management.html /
 * base.html's Reports modal / editing_log.html's parse form.
 *
 * Controlled: `value` is the current text, `onChange` fires as the user types,
 * `onSelect` fires when an option is chosen (click, Enter, or exact-match blur).
 *
 * `strict` turns this into a real select-with-search: `value`/`onChange` only
 * ever carry a committed option from `options`, never free-typed text — what
 * the user is typing lives in local `query` state until it resolves to a
 * match (click, Enter on the highlighted/sole match) or gets discarded on
 * blur. Use this whenever the field stores a reference to another record
 * (e.g. a project's client) where an unmatched string would silently save
 * garbage.
 */
export default function SearchableDropdown({
  value,
  onChange,
  onSelect,
  options,
  placeholder,
  renderOption,
  openOnFocus = true,
  required,
  name,
  className = "form-control",
  id,
  strict = false,
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [query, setQuery] = useState(value || "");
  const wrapRef = useRef(null);

  // In strict mode the input shows local, uncommitted search text; otherwise
  // it's a plain mirror of the committed value.
  useEffect(() => {
    if (strict) setQuery(value || "");
  }, [strict, value]);

  const displayValue = strict ? query : value || "";
  const filtered = (options || []).filter((opt) => (opt || "").toLowerCase().includes((displayValue || "").toLowerCase()));

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(opt) {
    if (strict) setQuery(opt);
    onChange?.(opt);
    onSelect?.(opt);
    setOpen(false);
    setActiveIdx(-1);
  }

  function handleKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && filtered[activeIdx]) {
        e.preventDefault();
        pick(filtered[activeIdx]);
      } else if (strict && filtered.length === 1) {
        // Typed enough to narrow to exactly one match — commit it.
        e.preventDefault();
        pick(filtered[0]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function handleBlur() {
    if (!strict) return;
    // Nothing typed that resolves to a real option — snap back to the last
    // committed value instead of leaving unmatched text sitting in the box.
    if (!(options || []).includes(query)) setQuery(value || "");
  }

  return (
    <div className="sd-wrap" ref={wrapRef}>
      <input
        type="text"
        id={id}
        name={name}
        className={className}
        placeholder={placeholder}
        value={displayValue}
        required={required}
        autoComplete="off"
        onChange={(e) => {
          if (strict) {
            setQuery(e.target.value);
          } else {
            onChange?.(e.target.value);
          }
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => openOnFocus && setOpen(true)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {open && filtered.length > 0 && (openOnFocus || displayValue.trim() !== "") && (
        <div className="sd-list">
          {filtered.map((opt, i) => (
            <div
              key={opt}
              className={`sd-item${i === activeIdx ? " active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(opt);
              }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              {renderOption ? renderOption(opt) : opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
