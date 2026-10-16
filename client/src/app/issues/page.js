"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import IssueModal, { ISSUE_STATUSES } from "../../components/IssueModal";
import { useIssues, useDeleteIssue } from "../../hooks/useIssues";
import { useAuth } from "../../lib/AuthContext";
import { useToast } from "../../lib/ToastContext";
import { api, ApiError } from "../../lib/api";

/**
 * "Issues" — every issue email a client sends gets logged here by the
 * production or QA team, with a screenshot of the email (or the email file)
 * attached. Once reviewed it's classified as Our Error / Not Our Error, with
 * our response email attached the same way (see routes/issues.js).
 */

const ISSUE_ROLES = ["admin", "management", "team_lead", "qaqc", "user"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-01" → "01 Sep 2026" */
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

const statusCls = (status) => (ISSUE_STATUSES.find((s) => s.value === status) || ISSUE_STATUSES[0]).cls;

function StatusPill({ status }) {
  const s = ISSUE_STATUSES.find((x) => x.value === status) || ISSUE_STATUSES[0];
  return (
    <span className={`co-status-pill issue-pill-${s.cls}`}>
      <i className={`bi ${s.icon}`} /> {status.toUpperCase()}
    </span>
  );
}

function StatCard({ value, label, sub, tone, icon, active, onClick }) {
  return (
    <button type="button" className={`rem-stat issue-stat-${tone}${active ? " active" : ""}`} onClick={onClick}>
      <i className={`bi ${icon} rem-stat-icon`} />
      <div>
        <div className="rem-stat-num">{value}</div>
        <div className="rem-stat-lbl">{label}</div>
        {sub && <div className="rem-stat-sub">{sub}</div>}
      </div>
    </button>
  );
}

export default function IssuesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, isLoading, isFetching, refetch } = useIssues();
  const { data: meta } = useQuery({ queryKey: ["projects-master"], queryFn: () => api.get("/projects") });
  const deleteIssue = useDeleteIssue();
  const issues = data?.issues || [];
  const canDelete = ["admin", "management"].includes(user?.role);

  const [modal, setModal] = useState(null); // null | { id } | { id: null } for new
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");

  // Look the open issue up from the live list so the modal reflects attachment removals immediately.
  const openIssue = modal?.id ? issues.find((i) => i.id === modal.id) : null;

  const projects = useMemo(() => [...new Set(issues.map((i) => i.project).filter(Boolean))].sort(), [issues]);
  const counts = useMemo(() => {
    const c = { total: issues.length };
    for (const s of ISSUE_STATUSES) c[s.value] = issues.filter((i) => i.status === s.value).length;
    return c;
  }, [issues]);

  const filtered = issues.filter((i) => {
    if (status && i.status !== status) return false;
    if (project && i.project !== project) return false;
    if (search) {
      const hay = `#${i.issue_number} ${i.title} ${i.project} ${i.client} ${i.reported_by} ${i.description} ${i.created_by}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const hasFilters = search || project || status;
  function clearFilters() {
    setSearch("");
    setProject("");
    setStatus("");
  }

  async function onDelete(issue) {
    if (!confirm(`Delete issue #${issue.issue_number} "${issue.title}" and all its attachments? This can't be undone.`)) return;
    try {
      const res = await deleteIssue.mutateAsync({ id: issue.id });
      toast.success(res.message);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to delete issue.");
    }
  }

  const errorRate = counts["Our Error"] + counts["Not Our Error"]
    ? Math.round((counts["Our Error"] / (counts["Our Error"] + counts["Not Our Error"])) * 100)
    : null;

  return (
    <AppLayout allow={ISSUE_ROLES}>
      <PageHero
        theme="navy"
        icon="bi-bug-fill"
        title="Issues"
        meta="Client-reported issues, logged by the Production and QA teams with the client's email and our response"
        right={
          <>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => refetch()} disabled={isFetching}>
              <i className={`bi bi-arrow-clockwise${isFetching ? " rem-spin" : ""}`} /> Refresh
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => setModal({ id: null })}>
              <i className="bi bi-plus-lg" /> Log Issue
            </button>
          </>
        }
      />

      <div className="rem-stats">
        <StatCard
          value={counts.total}
          label="Total issues"
          sub={errorRate === null ? "none classified yet" : `${errorRate}% of classified were our error`}
          tone="total"
          icon="bi-inboxes-fill"
          active={!status}
          onClick={() => setStatus("")}
        />
        {ISSUE_STATUSES.map((s) => (
          <StatCard
            key={s.value}
            value={counts[s.value]}
            label={s.value}
            sub={s.hint}
            tone={s.cls}
            icon={s.icon}
            active={status === s.value}
            onClick={() => setStatus((cur) => (cur === s.value ? "" : s.value))}
          />
        ))}
      </div>

      <div className="rem-filters">
        <div className="rem-search">
          <i className="bi bi-search" />
          <input
            className="form-control form-control-sm"
            placeholder="Search by issue #, subject, project, client or contact"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="form-select form-select-sm" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        {hasFilters && (
          <button className="btn btn-sm btn-link text-decoration-none" onClick={clearFilters}>
            <i className="bi bi-x-circle" /> Clear filters
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="rem-empty">
          <div className="spinner-border spinner-border-sm text-secondary" /> Loading issues…
        </div>
      ) : !issues.length ? (
        <div className="rem-empty">
          <i className="bi bi-inbox" /> No issues logged yet. Use <b>Log Issue</b> when a client emails about an issue.
        </div>
      ) : !filtered.length ? (
        <div className="rem-empty">
          <i className="bi bi-funnel" /> No issues match these filters.{" "}
          <button className="btn btn-sm btn-link p-0 align-baseline" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : (
        <div className="issue-table-wrap">
          <table className="table table-hover align-middle issue-table mb-0">
            <thead>
              <tr>
                <th>#</th>
                <th>Received</th>
                <th>Issue</th>
                <th>Project / Client</th>
                <th>Logged by</th>
                <th>Status</th>
                <th className="text-center">Emails</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => {
                const issueCount = i.attachments.filter((a) => a.kind === "issue").length;
                const responseCount = i.attachments.filter((a) => a.kind === "response").length;
                return (
                  <tr key={i.id} className={`issue-row-${statusCls(i.status)}`} onClick={() => setModal({ id: i.id })}>
                    <td className="text-muted fw-semibold">{i.issue_number}</td>
                    <td className="text-nowrap">{fmtDate(i.received_date)}</td>
                    <td className="issue-cell-title">
                      <div className="fw-semibold">{i.title}</div>
                      {i.reported_by && <div className="small text-muted">from {i.reported_by}</div>}
                    </td>
                    <td>
                      <div>{i.project || <span className="text-muted">—</span>}</div>
                      {i.client && <div className="small text-muted">{i.client}</div>}
                    </td>
                    <td>{i.created_by || <span className="text-muted">—</span>}</td>
                    <td>
                      <StatusPill status={i.status} />
                      {i.response_date && <div className="small text-muted mt-1">replied {fmtDate(i.response_date)}</div>}
                    </td>
                    <td className="text-center text-nowrap">
                      <span className={`issue-att-count${issueCount ? "" : " none"}`} title={`${issueCount} client email file(s)`}>
                        <i className="bi bi-envelope-exclamation" /> {issueCount}
                      </span>
                      <span className={`issue-att-count${responseCount ? "" : " none"}`} title={`${responseCount} response email file(s)`}>
                        <i className="bi bi-reply-fill" /> {responseCount}
                      </span>
                    </td>
                    <td className="text-end text-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm btn-outline-primary" title="Open / edit" onClick={() => setModal({ id: i.id })}>
                        <i className="bi bi-pencil-square" />
                      </button>
                      {canDelete && (
                        <button className="btn btn-sm btn-outline-danger ms-1" title="Delete" onClick={() => onDelete(i)}>
                          <i className="bi bi-trash" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <IssueModal
        open={!!modal && (!modal.id || !!openIssue)}
        issue={openIssue}
        onClose={() => setModal(null)}
        user={user}
        projectDetails={meta?.projectDetails || []}
      />
    </AppLayout>
  );
}
