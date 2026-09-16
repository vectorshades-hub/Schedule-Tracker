"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import { api } from "../../lib/api";

const ACTION_CLASS = { ADD: "action-add", UPDATE: "action-update", COMPLETED: "action-completed", DELETE: "action-delete" };
const ACTION_ICON = { ADD: "bi-plus-lg", UPDATE: "bi-pencil-fill", COMPLETED: "bi-check-circle-fill", DELETE: "bi-trash-fill" };

// Identity fields pulled out of `fields` into the compact "ID · PROJECT / SUBMISSION · CLIENT · TEAM" bar —
// whatever's actually present in a given notification (ADD carries all of these, UPDATE/DELETE far fewer).
const IDENTITY_FIELDS = [
  { key: "record_id", label: "ID", format: (v) => `#${v}` },
  { key: "project", label: "PROJECT", sep: "·" },
  { key: "submission", label: "SUBMISSION", sep: "/" },
  { key: "client", label: "CLIENT", sep: "·" },
  { key: "team", label: "TEAM", sep: "·" },
];
const IDENTITY_KEYS = new Set(IDENTITY_FIELDS.map((f) => f.key));

const FIELD_LABELS = { type: "Submission Type", sub_date: "Submission Date", due_date: "Due Date", remarks: "Remarks", status: "Status" };
function fieldLabel(k) {
  return FIELD_LABELS[k] || k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtTs(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get("/notifications") });
  const entries = data?.entries || [];

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [seenFilter, setSeenFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");

  async function markSeen(id) {
    await api.post("/notifications/mark-seen", { notif_id: id });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  const users = [...new Set(entries.map((e) => e.by_user).filter(Boolean))].sort();

  const filtered = entries.filter((e) => {
    if (search && !`${e.detail} ${e.by_user}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (actionFilter && e.action !== actionFilter) return false;
    if (seenFilter === "unseen" && e.seen) return false;
    if (seenFilter === "seen" && !e.seen) return false;
    if (userFilter && e.by_user !== userFilter) return false;
    return true;
  });

  const hasFilters = search || actionFilter || seenFilter || userFilter;
  function clearFilters() {
    setSearch("");
    setActionFilter("");
    setSeenFilter("");
    setUserFilter("");
  }

  const stats = {
    total: entries.length,
    add: entries.filter((e) => e.action === "ADD").length,
    update: entries.filter((e) => e.action === "UPDATE").length,
    del: entries.filter((e) => e.action === "DELETE").length,
  };

  return (
    <AppLayout allow={["admin", "management"]}>
      <PageHero
        theme="navy"
        icon="bi-bell-fill"
        title="Notifications"
        meta={
          <>
            <i className="bi bi-clock-history me-1" /> Team activity — newest first
          </>
        }
      />

      <div className="notif-stats">
        <div className="notif-stat">
          <div className="notif-stat-num">{stats.total}</div>
          <div className="notif-stat-lbl">Total</div>
        </div>
        <div className="notif-stat notif-stat-added">
          <div className="notif-stat-num">{stats.add}</div>
          <div className="notif-stat-lbl">Added</div>
        </div>
        <div className="notif-stat notif-stat-updated">
          <div className="notif-stat-num">{stats.update}</div>
          <div className="notif-stat-lbl">Updated</div>
        </div>
        <div className="notif-stat notif-stat-deleted">
          <div className="notif-stat-num">{stats.del}</div>
          <div className="notif-stat-lbl">Deleted</div>
        </div>
      </div>

      <div className="notif-filters">
        <div>
          <label className="notif-filter-label">Search</label>
          <input className="form-control" placeholder="User, project, submission…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label className="notif-filter-label">Action</label>
          <select className="form-select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All Actions</option>
            <option value="ADD">ADD</option>
            <option value="UPDATE">UPDATE</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
        <div>
          <label className="notif-filter-label">Status</label>
          <select className="form-select" value={seenFilter} onChange={(e) => setSeenFilter(e.target.value)}>
            <option value="">All</option>
            <option value="unseen">Unseen</option>
            <option value="seen">Seen</option>
          </select>
        </div>
        <div>
          <label className="notif-filter-label">User</label>
          <select className="form-select" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
            <option value="">All Users</option>
            {users.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <button type="button" className="notif-clear-btn" disabled={!hasFilters} onClick={clearFilters}>
          <i className="bi bi-x-circle" /> Clear
        </button>
      </div>

      <div className="notif-grid">
        {filtered.map((e) => {
          const actionClass = ACTION_CLASS[e.action] || "action-other";
          const identity = IDENTITY_FIELDS.filter((f) => e.fields[f.key]);
          const detailEntries = Object.entries(e.fields).filter(([k, v]) => v && !IDENTITY_KEYS.has(k));

          return (
            <div key={e.id} className={`notif-card2 ${actionClass}${!e.seen ? " unseen" : ""}`}>
              <div className="notif-card-top">
                <div className="d-flex align-items-center gap-2">
                  <span className={`notif-action-pill ${actionClass}`}>
                    <i className={`bi ${ACTION_ICON[e.action] || "bi-robot"}`} /> {e.action}
                  </span>
                  <i className="bi bi-person-circle notif-user-icon" title={e.by_user} />
                </div>
                <span className="notif-time"><i className="bi bi-clock" /> {fmtTs(e.ts)}</span>
              </div>

              {identity.length > 0 && (
                <div className="notif-id-bar">
                  {identity.map((f, i) => (
                    <span key={f.key}>
                      {i > 0 && <span className="nib-sep">{f.sep}</span>}
                      <span className="nib-label">{f.label}</span>
                      <span className="nib-val">{f.format ? f.format(e.fields[f.key]) : e.fields[f.key]}</span>
                    </span>
                  ))}
                </div>
              )}

              {e.action === "ADD" && detailEntries.length > 0 && (
                <div className="notif-tiles">
                  {detailEntries.map(([k, v]) => (
                    <div key={k} className="notif-tile">
                      <div className="nt-label">{fieldLabel(k)}</div>
                      <div className="nt-val">{v}</div>
                    </div>
                  ))}
                </div>
              )}

              {["UPDATE", "COMPLETED"].includes(e.action) && e.changes.length > 0 && (
                <div className="notif-changes">
                  {e.changes.map((c, i) => (
                    <div key={i} className="notif-change-row">
                      <span className="notif-change-field">{c.field}</span>
                      <span className="change-old">{c.old_value}</span>
                      <i className="bi bi-arrow-right text-muted" />
                      <span className="change-new">{c.new_value}</span>
                    </div>
                  ))}
                </div>
              )}

              {e.action === "DELETE" && (
                <div className="alert alert-danger py-1 px-2 mb-0 small">{e.fields.detail || e.detail}</div>
              )}
              {!["ADD", "UPDATE", "COMPLETED", "DELETE"].includes(e.action) && (
                <div className="alert alert-secondary py-1 px-2 mb-0 small"><i className="bi bi-robot" /> {e.detail}</div>
              )}

              <div className="notif-card-footer">
                {e.seen ? (
                  <span className="notif-seen-label"><i className="bi bi-check-lg" /> Seen</span>
                ) : (
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => markSeen(e.id)}>
                    Mark seen
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!filtered.length && <div className="empty-state"><i className="bi bi-bell-slash" />No notifications.</div>}
      </div>
    </AppLayout>
  );
}
