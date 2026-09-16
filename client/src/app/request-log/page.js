"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import StatPill from "../../components/StatPill";
import { api } from "../../lib/api";

function statusClass(status) {
  const d = status?.[0];
  return d === "2" ? "status-2" : d === "3" ? "status-3" : d === "4" ? "status-4" : d === "5" ? "status-5" : "status-2";
}
function durationClass(ms) {
  return ms < 150 ? "dur-fast" : ms < 500 ? "dur-medium" : "dur-slow";
}

export default function RequestLogPage() {
  const { data, refetch } = useQuery({ queryKey: ["request-log"], queryFn: () => api.get("/request-log") });
  const entries = data?.entries || [];

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) refetch();
    }, 30000);
    return () => clearInterval(id);
  }, [refetch]);

  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const users = [...new Set(entries.map((e) => e.username))].sort();
  const filtered = entries.filter((e) => {
    if (search && !`${e.path} ${e.username}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (methodFilter && e.method !== methodFilter) return false;
    if (statusFilter && e.status[0] !== statusFilter) return false;
    if (userFilter && e.username !== userFilter) return false;
    if (roleFilter && e.role !== roleFilter) return false;
    return true;
  });

  const agg = data?.aggregates || { methods: {}, statuses: {}, users: {} };
  const errorCount = Object.entries(agg.statuses).filter(([s]) => s[0] >= "4").reduce((a, [, n]) => a + n, 0);
  const okCount = entries.length - errorCount;

  return (
    <AppLayout allow={["admin"]}>
      <PageHero theme="deepblue" icon="bi-terminal-fill" title="Request Log" meta={`${entries.length} requests`} />

      <div className="stats-bar">
        <StatPill num={entries.length} label="Total" color="#0f3460" />
        <StatPill num={agg.methods.GET || 0} label="GET" color="#27ae60" />
        <StatPill num={agg.methods.POST || 0} label="POST" color="#e67e22" />
        <StatPill num={okCount} label="2xx/3xx" color="#3498db" />
        <StatPill num={errorCount} label="Errors" color="#e74c3c" />
      </div>

      <div className="filter-bar row g-2">
        <div className="col-md-3"><input className="form-control" placeholder="Search path/user…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="col-md-2">
          <select className="form-select" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
            <option value="">All methods</option>
            {Object.keys(agg.methods).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="col-md-2">
          <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="2">2xx</option><option value="3">3xx</option><option value="4">4xx</option><option value="5">5xx</option>
          </select>
        </div>
        <div className="col-md-2">
          <select className="form-select" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
            <option value="">All users</option>
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="col-md-2">
          <select className="form-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            <option value="admin">admin</option><option value="management">management</option><option value="team_lead">team_lead</option>
          </select>
        </div>
      </div>

      <div className="table-wrap theme-deepblue">
        <table className="table table-sm mb-0">
          <thead>
            <tr><th>Timestamp</th><th>Method</th><th>Path</th><th>Status</th><th>User</th><th>Role</th><th>IP</th><th>Duration</th><th>User Agent</th></tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={i}>
                <td>{new Date(e.ts).toLocaleString()}</td>
                <td><span className={`method-badge badge-${e.method}`}>{e.method}</span></td>
                <td className="path-cell text-truncate" style={{ maxWidth: 220 }} title={e.path}>{e.path}</td>
                <td><span className={`status-badge ${statusClass(e.status)}`}>{e.status}</span></td>
                <td>{e.username}</td>
                <td>{e.role}</td>
                <td>{e.ip}</td>
                <td className={durationClass(parseInt(e.duration))}>{e.duration}</td>
                <td className="text-truncate" style={{ maxWidth: 160, fontSize: "0.7rem", color: "#999" }} title={e.user_agent}>{e.user_agent}</td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={9} className="empty-state"><i className="bi bi-terminal" />No entries.</td></tr>}
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
}
