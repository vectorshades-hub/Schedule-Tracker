"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import Modal from "./Modal";

const SECTION_META = {
  overdue: { label: "Overdue", icon: "⚠️", pillClass: "dp-pill-overdue", barClass: "dp-section-bar-overdue", numClass: "dp-row-num-overdue" },
  today: { label: "Due Today", icon: "🕐", pillClass: "dp-pill-today", barClass: "dp-section-bar-today", numClass: "dp-row-num-today" },
  tomorrow: { label: "Due Tomorrow", icon: "✅", pillClass: "dp-pill-tomorrow", barClass: "dp-section-bar-tomorrow", numClass: "dp-row-num-tomorrow" },
  day3: { label: "Due in 2–3 Days", icon: "📅", pillClass: "dp-pill-day3", barClass: "dp-section-bar-day3", numClass: "dp-row-num-day3" },
};

/** "MM-DD-YYYY" (server's fmtDate output) -> "Aug 4" */
function shortDate(mmddyyyy) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(mmddyyyy || "");
  if (!m) return mmddyyyy || "";
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "YYYY-MM-DD" -> "Tuesday, August 25, 2026" */
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function rowMeta(sectionKey, r) {
  const due = shortDate(r.due_date);
  if (sectionKey === "overdue") {
    const n = Math.abs(r.days_left);
    return { num: n, desc: `${n}d overdue`, due };
  }
  if (sectionKey === "today") return { num: 0, desc: "due today", due };
  if (sectionKey === "tomorrow") return { num: 1, desc: "due tomorrow", due };
  return { num: r.days_left, desc: `due in ${r.days_left}d`, due };
}

/** Ported from index.html/management.html's #dailyPopupOverlay — shown once per calendar day per user. */
export default function DailyPopup({ username, role }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!username) return;
    const key = `dp_shown_${username}`;
    let cancelled = false;
    api.get("/daily-popup").then((d) => {
      if (cancelled) return;
      setData(d);
      try {
        if (localStorage.getItem(key) !== d.today) {
          setOpen(true);
          localStorage.setItem(key, d.today);
        }
      } catch {
        setOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (!data || !data.records?.length) return null;

  const overdue = data.records.filter((r) => r.days_left < 0);
  const today = data.records.filter((r) => r.days_left === 0);
  const tomorrow = data.records.filter((r) => r.days_left === 1);
  const day3 = data.records.filter((r) => r.days_left >= 2);

  const scopeLabel =
    role === "admin" || role === "management" ? "Showing all teams' deadlines" : "Showing your assigned deadlines only";

  const sections = [
    { key: "overdue", items: overdue },
    { key: "today", items: today },
    { key: "tomorrow", items: tomorrow },
    { key: "day3", items: day3 },
  ]
    .map((s) => ({ ...s, ...SECTION_META[s.key] }))
    .filter((s) => s.items.length);

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      theme="deadlines"
      maxWidth={640}
      bodyClassName="p-0"
      title={
        <div className="dp-header-inner">
          <div className="dp-header-icon">⚠️</div>
          <div>
            <div className="dp-header-title">Upcoming &amp; Overdue Deadlines</div>
            <div className="dp-header-sub">
              <span>📅</span> Today is {longDate(data.today)}
            </div>
            <div className="dp-header-sub">
              <span>🌐</span> {scopeLabel}
            </div>
          </div>
        </div>
      }
      footer={
        <div className="dp-footer">
          <span className="dp-footer-note">
            <span>ⓘ</span> Overdue &amp; records due within 3 days
          </span>
          <button type="button" className="dp-footer-btn" onClick={() => setOpen(false)}>
            Got it ✓
          </button>
        </div>
      }
    >
      <div className="dp-pills">
        {sections.map((s) => (
          <span key={s.key} className={`dp-pill ${s.pillClass}`}>
            {s.icon} {s.items.length} {s.label}
          </span>
        ))}
      </div>
      <div className="dp-list">
        {sections.map((s) => (
          <div key={s.key}>
            <div className={`dp-section-bar ${s.barClass}`}>
              <span className="dot" />
              {s.label.toUpperCase()} ({s.items.length})
            </div>
            {s.items.map((r, i) => {
              const m = rowMeta(s.key, r);
              return (
                <div className="dp-row" key={i}>
                  <div className="dp-row-main">
                    <div className="dp-row-project">{r.project}</div>
                    <div className="dp-row-submission">{r.submission}</div>
                    <div className="dp-row-chips">
                      {r.client && <span className="dp-chip-client">{r.client}</span>}
                      {r.team && <span className="dp-chip-team">{r.team}</span>}
                    </div>
                  </div>
                  <div className="dp-row-side">
                    <div className={`dp-row-num ${s.numClass}`}>{m.num}</div>
                    <div className="dp-row-desc">{m.desc}</div>
                    <div className="dp-row-date">{m.due}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Modal>
  );
}
