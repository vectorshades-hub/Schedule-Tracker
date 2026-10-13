"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";

const POLL_MS = 300000; // 5 minutes, matches base.html's _initNotifPermission()
const FIRST_POLL_MS = 2000;
const RFI_REMINDER_KEY = "_rfi_reminders_shown"; // localStorage: { day, ids } — RFIs already notified today
const RFI_REMINDER_SUMMARY_AFTER = 3; // more than this many new ones → one summary notification instead of one each

function localDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Ported from base.html's notification badge + native-Notification polling IIFE.
 * Also polls the pending-RFI reminders (GET /rfis/reminders): a separate alarm
 * icon linking to /reminders shows how many there are in an amber badge, and each one fires a browser notification at most
 * once per day (tracked in localStorage so new tabs/logins don't repeat it).
 * `remindersOnly` (team leads) skips the team-activity bell and its polling —
 * /notifications is admin/management only — and shows just the alarm icon. */
export default function NotificationBell({ remindersOnly = false }) {
  const [count, setCount] = useState(0);
  const [reminderCount, setReminderCount] = useState(0);
  const shownIds = useRef(new Set());
  const router = useRouter();

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("_notif_shown");
      if (stored) shownIds.current = new Set(stored.split(",").slice(-50));
    } catch {}

    function canNotify() {
      return typeof Notification !== "undefined" && Notification.permission === "granted";
    }

    function showBrowserNotif(title, body, tag, href = "/notifications") {
      if (!canNotify()) return;
      const n = new Notification(title, { body, tag, icon: "/logo.png" });
      n.onclick = () => {
        window.focus();
        router.push(href);
      };
      setTimeout(() => n.close(), 8000);
    }

    function processRfiReminders(data, coCount = 0) {
      const reminders = data?.reminders || [];
      setReminderCount(reminders.length + coCount);
      // Don't mark anything as notified until the browser can actually show it.
      if (!reminders.length || !canNotify()) return;

      const day = localDayKey();
      let shown = [];
      try {
        const stored = JSON.parse(localStorage.getItem(RFI_REMINDER_KEY) || "null");
        if (stored && stored.day === day) shown = stored.ids || [];
      } catch {}
      const fresh = reminders.filter((r) => !shown.includes(r.id));
      if (!fresh.length) return;

      if (fresh.length > RFI_REMINDER_SUMMARY_AFTER) {
        showBrowserNotif(
          `${fresh.length} RFIs pending over ${data.threshold_days} days`,
          fresh.slice(0, 3).map((r) => `${r.project} — ${r.title} (${r.days_pending}d)`).join("\n") + "\n…",
          `st-rfi-reminders-${day}`,
          "/reminders"
        );
      } else {
        for (const r of fresh) {
          showBrowserNotif(
            `RFI pending ${r.days_pending} days`,
            `${r.project} — ${r.rfi_number ? `#${r.rfi_number} ` : ""}${r.title}`,
            `st-rfi-${r.id}-${day}`,
            `/projects/${encodeURIComponent(r.project)}#rfi-section`
          );
        }
      }
      try {
        localStorage.setItem(RFI_REMINDER_KEY, JSON.stringify({ day, ids: [...shown, ...fresh.map((r) => r.id)] }));
      } catch {}
    }

    function processLatest(latest) {
      for (const item of latest || []) {
        if (shownIds.current.has(item.id)) continue;
        shownIds.current.add(item.id);
        showBrowserNotif(item.title, item.body, `st-notif-${item.id}`);
      }
      try {
        sessionStorage.setItem("_notif_shown", [...shownIds.current].slice(-50).join(","));
      } catch {}
    }

    async function refreshBadge() {
      if (!remindersOnly) {
        try {
          const data = await api.get("/notifications/unseen-count");
          setCount(data.count || 0);
          processLatest(data.latest);
        } catch {}
      }
      // Change Orders pending approval past the threshold only add to the badge count.
      let coCount = 0;
      try {
        coCount = ((await api.get("/change-orders/reminders"))?.reminders || []).length;
      } catch {}
      try {
        processRfiReminders(await api.get("/rfis/reminders"), coCount);
      } catch {}
    }

    let interval;
    function startPolling() {
      refreshBadge();
      setTimeout(refreshBadge, FIRST_POLL_MS);
      interval = setInterval(refreshBadge, POLL_MS);
    }

    if (typeof Notification !== "undefined") {
      if (Notification.permission === "granted") {
        startPolling();
      } else if (Notification.permission === "default") {
        const askOnce = () => {
          Notification.requestPermission().finally(startPolling);
          document.removeEventListener("click", askOnce);
        };
        document.addEventListener("click", askOnce, { once: true });
        startPolling(); // still poll silently even before permission is granted
      } else {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <a href="/reminders" className="position-relative text-light" title={`Reminders${reminderCount ? ` — ${reminderCount} pending RFI(s) / CO approval(s)` : ""}`}>
        <i className="bi bi-alarm-fill fs-5" />
        {reminderCount > 0 && (
          <span className="position-absolute badge rounded-pill bg-warning text-dark" style={{ top: -6, right: -10, fontSize: "0.65rem" }}>
            {reminderCount > 99 ? "99+" : reminderCount}
          </span>
        )}
      </a>
      {!remindersOnly && (
        <a href="/notifications" className="position-relative text-light" title="Notifications">
          <i className="bi bi-bell-fill fs-5" />
          {count > 0 && (
            <span className="position-absolute badge rounded-pill bg-danger" style={{ top: -6, right: -10, fontSize: "0.65rem" }}>
              {count > 99 ? "99+" : count}
            </span>
          )}
        </a>
      )}
    </>
  );
}
