"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";

const POLL_MS = 300000; // 5 minutes, matches base.html's _initNotifPermission()
const FIRST_POLL_MS = 2000;

/** Ported from base.html's notification badge + native-Notification polling IIFE. */
export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const shownIds = useRef(new Set());
  const router = useRouter();

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("_notif_shown");
      if (stored) shownIds.current = new Set(stored.split(",").slice(-50));
    } catch {}

    function showBrowserNotif(title, body, tag) {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const n = new Notification(title, { body, tag, icon: "/logo.png" });
      n.onclick = () => {
        window.focus();
        router.push("/notifications");
      };
      setTimeout(() => n.close(), 8000);
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
      try {
        const data = await api.get("/notifications/unseen-count");
        setCount(data.count || 0);
        processLatest(data.latest);
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
    <a href="/notifications" className="position-relative text-light" title="Notifications">
      <i className="bi bi-bell-fill fs-5" />
      {count > 0 && (
        <span className="position-absolute badge rounded-pill bg-danger" style={{ top: -6, right: -10, fontSize: "0.65rem" }}>
          {count > 99 ? "99+" : count}
        </span>
      )}
    </a>
  );
}
