"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "../../components/AppLayout";
import { api } from "../../lib/api";

const BADGE_CLASS = { success: "bg-success", warning: "bg-warning text-dark", danger: "bg-danger", info: "bg-info text-dark", secondary: "bg-secondary" };

export default function ActivityLogPage() {
  const { data } = useQuery({ queryKey: ["activity-log"], queryFn: () => api.get("/activity-log") });
  const entries = data?.entries || [];

  const [tsFilter, setTsFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [detailFilter, setDetailFilter] = useState("");

  const users = [...new Set(entries.map((e) => e.user))].sort();
  const actions = [...new Set(entries.map((e) => e.action))].sort();
  const filtered = entries.filter((e) => {
    if (tsFilter && !e.ts.includes(tsFilter)) return false;
    if (userFilter && e.user !== userFilter) return false;
    if (actionFilter && e.action !== actionFilter) return false;
    if (detailFilter && !e.detail.toLowerCase().includes(detailFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <AppLayout allow={["admin"]}>
      <div className="filter-bar">
        <div className="section-title mb-2">Activity Log <span className="text-muted normal-case" style={{ textTransform: "none", fontWeight: 400 }}>({filtered.length} of {entries.length})</span></div>
        <div className="row g-2">
          <div className="col-md-3"><input className="form-control" placeholder="Timestamp contains…" value={tsFilter} onChange={(e) => setTsFilter(e.target.value)} /></div>
          <div className="col-md-3">
            <select className="form-select" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="">All users</option>
              {users.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <select className="form-select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="">All actions</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="col-md-3"><input className="form-control" placeholder="Detail contains…" value={detailFilter} onChange={(e) => setDetailFilter(e.target.value)} /></div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table table-sm mb-0">
          <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={i}>
                <td>{e.ts}</td>
                <td>{e.user}</td>
                <td><span className={`badge ${BADGE_CLASS[e.badge] || "bg-secondary"}`}>{e.action}</span></td>
                <td>{e.detail}</td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={4} className="text-center text-muted py-4">No entries.</td></tr>}
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
}
