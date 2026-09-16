"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(null);

const ICONS = {
  success: "bi-check-circle-fill",
  error: "bi-x-circle-fill",
  info: "bi-info-circle-fill",
};
const DEFAULT_DURATION = { success: 4000, error: 6000, info: 4000 };

let idSeq = 0;

/**
 * App-wide toast notifications, replacing the old alert()s scattered across
 * the add/edit/delete flows (records, projects, clients, users, ...).
 * Mounted once in the root layout — call useToast() from anywhere.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const push = useCallback(
    (message, type, duration) => {
      const id = ++idSeq;
      const ms = duration ?? DEFAULT_DURATION[type] ?? 4000;
      setToasts((list) => [...list, { id, message, type }]);
      if (ms > 0) {
        timers.current[id] = setTimeout(() => dismiss(id), ms);
      }
      return id;
    },
    [dismiss]
  );

  const toast = {
    success: (message, duration) => push(message, "success", duration),
    error: (message, duration) => push(message, "error", duration),
    info: (message, duration) => push(message, "info", duration),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-item toast-${t.type}`}>
            <i className={`bi ${ICONS[t.type] || ICONS.info} toast-icon`} />
            <span className="toast-msg">{t.message}</span>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <i className="bi bi-x-lg" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
