"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { useToast } from "../lib/ToastContext";
import { downloadRfiMarkup } from "../lib/rfiMarkupExport";

const OUTLOOK_MAIL_URL = "https://outlook.cloud.microsoft/mail";

// What the row's email button does — picked from its dropdown, remembered per browser.
const EMAIL_ACTIONS = [
  // `short` is the button text; `label` the menu item / tooltip.
  { key: "copy_download", short: "Email + Markup", label: "Copy email + markup", icon: "bi-envelope-arrow-down" },
  { key: "copy", short: "Copy email", label: "Copy email", icon: "bi-envelope" },
  { key: "copy_download_open", short: "Email + Outlook", label: "Copy + markup + Outlook", icon: "bi-envelope-open" },
];
const EMAIL_ACTION_KEY = "rfiEmailAction";
function loadEmailAction() {
  try {
    const saved = localStorage.getItem(EMAIL_ACTION_KEY);
    return EMAIL_ACTIONS.some((a) => a.key === saved) ? saved : EMAIL_ACTIONS[0].key;
  } catch {
    return EMAIL_ACTIONS[0].key;
  }
}
function storeEmailAction(key) {
  try {
    localStorage.setItem(EMAIL_ACTION_KEY, key);
  } catch {
    // storage unavailable — the choice just won't persist
  }
}

const STATUS_ICON = {
  Pending: "bi-hourglass-split",
  Overdue: "bi-exclamation-triangle-fill",
  Returned: "bi-check-circle-fill",
};

function rfiProgressPct(rfi) {
  const questions = rfi.questions || [];
  if (!questions.length) return 0;
  const received = questions.filter((q) => q.response_received_date).length;
  return Math.round((received / questions.length) * 100);
}

const EMAIL_INTRO = ["Hi,", "Please see the below clarification questions and respond asap.", ""];

const numbered = (questions) =>
  questions
    .map((q) => (q.text || "").trim())
    .filter(Boolean)
    .map((t, i) => `${i + 1}. ${t}`);

function rfiEmailText(rfi) {
  return [...EMAIL_INTRO, ...numbered(rfi.questions || [])].join("\n");
}

/** One email covering every unanswered question across `rfis`, grouped under
 * an "RFI #123 - Title" heading per RFI. Returns null when nothing is open. */
export function unansweredRfisEmailText(rfis) {
  const blocks = rfis
    .filter((r) => r.status !== "Returned")
    .map((r) => ({ r, open: (r.questions || []).filter((q) => !q.response_received_date && (q.text || "").trim()) }))
    .filter((b) => b.open.length)
    .map(({ r, open }) => [`${r.type}${r.rfi_number ? ` #${r.rfi_number}` : ""} - ${r.title}`, ...numbered(open)].join("\n"));
  return blocks.length ? [...EMAIL_INTRO, blocks.join("\n\n")].join("\n") : null;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // navigator.clipboard needs a secure context (https/localhost) — fall back for plain http.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** One RFI/Clarification row — compact and scannable (Type, Title, Status,
 * Progress %) so a whole project's RFI list reads at a glance. Click
 * anywhere on the row (outside Edit/Delete) to call `onView`, which opens
 * RfiDetailsModal — that modal is rendered by the parent (SubmissionOverview),
 * not here, because it must sit outside .detail-panel (see the comment next
 * to its JSX for why nesting it inside this row's panel breaks position:fixed). */
export default function RfiCard({ rfi, canEdit, canDelete, onEdit, onDelete, onView, submissionOptions = [] }) {
  const pct = rfiProgressPct(rfi);
  const statusKey = rfi.status.toLowerCase();
  const toast = useToast();
  const [copyState, setCopyState] = useState(null); // null | "ok" | "fail"
  const [emailAction, setEmailAction] = useState(EMAIL_ACTIONS[0].key);
  const [menuPos, setMenuPos] = useState(null); // {top, right} in viewport px while the dropdown is open
  const [busy, setBusy] = useState(false);
  const toggleRef = useRef(null);
  const menuRef = useRef(null);
  const action = EMAIL_ACTIONS.find((a) => a.key === emailAction) || EMAIL_ACTIONS[0];
  const hasQuestions = (rfi.questions || []).length > 0;

  useEffect(() => setEmailAction(loadEmailAction()), []);

  // Close the dropdown on outside click, Escape, scroll or resize.
  useEffect(() => {
    if (!menuPos) return;
    const close = () => setMenuPos(null);
    const onDown = (e) => !menuRef.current?.contains(e.target) && !toggleRef.current?.contains(e.target) && close();
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menuPos]);

  function toggleMenu() {
    if (menuPos) return setMenuPos(null);
    const r = toggleRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }

  function pickAction(key) {
    setEmailAction(key);
    storeEmailAction(key);
    setMenuPos(null);
  }

  /** Runs the selected email action: copy first (the clipboard needs this tab focused), then open Outlook, then download. */
  async function handleEmailAction() {
    const ok = await copyText(rfiEmailText(rfi));
    setCopyState(ok ? "ok" : "fail");
    setTimeout(() => setCopyState(null), 2000);
    if (action.key === "copy_download_open") window.open(OUTLOOK_MAIL_URL, "_blank", "noopener");
    if (action.key === "copy") return;
    if (!rfi.markup_doc_count) {
      toast.success("Email copied — this RFI has no markup to download.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.get(`/rfis/${rfi.id}/markups`);
      await downloadRfiMarkup(rfi, res.docs || []);
    } catch (e) {
      toast.error(`Markup download failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  function handleRowKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onView(rfi);
    }
  }

  return (
    <div
      className={`rfi-row rfi-row-${statusKey}`}
      role="button"
      tabIndex={0}
      onClick={() => onView(rfi)}
      onKeyDown={handleRowKeyDown}
    >
      <div className="rfi-row-content">
        <div className="rfi-row-top">
          <span className="rfi-type-pill">{rfi.type}</span>
          {rfi.rfi_number && <span className="rfi-row-title text-muted">#{rfi.rfi_number}</span>}
          <span className="rfi-row-title rfi-title-cap">{rfi.title}</span>
        </div>

        <div className="rfi-row-bottom">
          <span className={`co-status-pill rfi-status-${statusKey}`}>
            <i className={`bi ${STATUS_ICON[rfi.status] || "bi-hourglass-split"}`} /> {rfi.status.toUpperCase()}
          </span>

          <div className="rfi-row-progress">
            <div className="rfi-row-progress-track">
              <div
                className="rfi-row-progress-bar"
                style={{ width: `${pct}%`, background: pct === 100 ? "#22c55e" : "#f0b429" }}
              />
            </div>
            <span className="rfi-row-progress-pct">{pct}%</span>
          </div>

          <div className="rfi-row-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <div className="btn-group btn-group-sm">
              <button
                type="button"
                className={`btn ${copyState === "ok" ? "btn-success" : copyState === "fail" ? "btn-outline-danger" : "btn-outline-secondary"}`}
                onClick={handleEmailAction}
                disabled={!hasQuestions || busy}
                title={`${action.label} — with this RFI's questions`}
              >
                {busy ? (
                  <span className="spinner-border spinner-border-sm" />
                ) : (
                  <i className={`bi ${copyState === "ok" ? "bi-check2" : action.icon}`} />
                )}{" "}
                {copyState === "ok" ? "Copied" : copyState === "fail" ? "Copy failed" : action.short}
              </button>
              <button
                type="button"
                ref={toggleRef}
                className="btn btn-outline-secondary dropdown-toggle dropdown-toggle-split"
                onClick={toggleMenu}
                disabled={!hasQuestions}
                aria-haspopup="menu"
                aria-expanded={!!menuPos}
                aria-label="Choose what the email button does"
              />
            </div>
            {menuPos &&
              createPortal(
                <div
                  ref={menuRef}
                  className="dropdown-menu show rfi-email-menu"
                  role="menu"
                  style={{ position: "fixed", top: menuPos.top, right: menuPos.right, left: "auto" }}
                >
                  {EMAIL_ACTIONS.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={a.key === emailAction}
                      className={`dropdown-item${a.key === emailAction ? " active" : ""}`}
                      onClick={() => pickAction(a.key)}
                    >
                      <i className={`bi ${a.icon} me-2`} />
                      {a.label}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            {canEdit && (
              <button type="button" className="btn btn-sm btn-warning" onClick={() => onEdit(rfi)} title="Edit" aria-label="Edit">
                <i className="bi bi-pencil" />
              </button>
            )}
            {canDelete && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(rfi)} title="Delete" aria-label="Delete">
                <i className="bi bi-trash" />
              </button>
            )}
          </div>
        </div>
      </div>

      <i className="bi bi-chevron-right rfi-row-chevron" aria-hidden="true" />
    </div>
  );
}
