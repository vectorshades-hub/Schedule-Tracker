"use client";
import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { useToast } from "../lib/ToastContext";
import { getChangeOrderStatus } from "../lib/changeOrderStatus";

function sumHours(rows) {
  return rows.reduce((sum, r) => sum + (r.hours || 0), 0);
}

function fmtNum(n) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Sits in the project detail page's PageHero `right` slot: the project's
 * quoted hours (editable by anyone who can edit records — same
 * settingsService.canUpdateRecords flag as canEdit elsewhere) plus each
 * Change Order's hours split by its status (see lib/changeOrderStatus) —
 * "Completed" once finance has approved it, "Pending" otherwise.
 */
export default function ProjectHeroExtras({ projectName, canEdit, quotedHours, onQuotedHoursChanged, changeOrders }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setValue(String(quotedHours ?? 0));
    setEditing(true);
  }

  async function save() {
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours < 0) {
      toast.error("Enter a non-negative number of hours.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/projects/${encodeURIComponent(projectName)}/quoted-hours`, { quoted_hours: hours });
      toast.success("Quoted hours updated.");
      setEditing(false);
      onQuotedHoursChanged?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to update quoted hours.");
    } finally {
      setSaving(false);
    }
  }

  const completedHours = sumHours(changeOrders.filter((c) => getChangeOrderStatus(c).key === "finance"));
  const pendingHours = sumHours(changeOrders.filter((c) => getChangeOrderStatus(c).key !== "finance"));

  return (
    <div className="hero-extra-row">
      <div className="hero-stat-card">
        <div className="hero-stat-card-label">
          <span className="hero-stat-icon hero-stat-icon-indigo"><i className="bi bi-clock-history" /></span>
          Quoted Hours
        </div>
        {editing ? (
          <div className="hero-stat-edit-row">
            <input
              type="number"
              min={0}
              step="0.5"
              className="form-control form-control-sm"
              style={{ width: 90 }}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
              <i className="bi bi-check-lg" />
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(false)} disabled={saving}>
              <i className="bi bi-x-lg" />
            </button>
          </div>
        ) : (
          <div className="hero-stat-card-value">
            <span>{fmtNum(quotedHours || 0)}h</span>
            {canEdit && (
              <button type="button" className="hero-stat-edit-btn" title="Edit quoted hours" onClick={startEdit}>
                <i className="bi bi-pencil" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="hero-stat-card co-earnings-card">
        <div className="hero-stat-card-label">
          <span className="hero-stat-icon hero-stat-icon-green"><i className="bi bi-cash-coin" /></span>
          Earnings Through CO
        </div>
        <div className="co-earnings-cols">
          <div className="co-earnings-col co-earnings-completed">
            <div className="co-earnings-col-title">Completed</div>
            <div className="co-earnings-amount">{fmtNum(completedHours)}h</div>
          </div>
          <div className="co-earnings-divider" />
          <div className="co-earnings-col co-earnings-pending">
            <div className="co-earnings-col-title">Pending</div>
            <div className="co-earnings-amount">{fmtNum(pendingHours)}h</div>
          </div>
        </div>
      </div>
    </div>
  );
}
