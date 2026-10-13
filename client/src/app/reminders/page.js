"use client";
import { useMemo, useState } from "react";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import { useRfiReminders } from "../../hooks/useRfis";
import { useCoApprovalReminders } from "../../hooks/useChangeOrders";
import { useAuth } from "../../lib/AuthContext";

/**
 * "Reminders" — RFIs across all projects still waiting on a response more
 * than `threshold_days` after being sent (rfis.js's GET /reminders). The
 * navbar alarm icon (NotificationBell) polls the same endpoint for its amber
 * badge + browser notifications, which link here. Team leads see only RFIs
 * on their own submissions/projects (scoped server-side).
 *
 * RFIs are grouped into urgency bands by how long they've been waiting, so the
 * oldest ones read first; the stat cards double as quick filters.
 *
 * Above them: team-lead Change Orders still pending approval more than the
 * same threshold (changeOrders.js's GET /reminders) — approvers see the ones
 * they can approve, team leads their own.
 */

// Urgency bands by days waiting — checked top-down, first match wins.
const BANDS = [
  { key: "critical", min: 15, label: "Critical", hint: "waiting 15+ days", icon: "bi-exclamation-octagon-fill" },
  { key: "urgent", min: 10, label: "Urgent", hint: "waiting 10–14 days", icon: "bi-exclamation-triangle-fill" },
  { key: "followup", min: 0, label: "Follow up", hint: "recently passed the reminder threshold", icon: "bi-clock-fill" },
];
const bandOf = (days) => BANDS.find((b) => days >= b.min);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-01" → "01 Sep 2026" */
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Whole days an ISO date is in the past (0 if today/future/blank). */
function daysLate(iso) {
  if (!iso) return 0;
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  const diff = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d);
  return Math.max(0, Math.floor(diff / 86400000));
}

function ReminderCard({ r }) {
  const band = bandOf(r.days_pending);
  const total = r.questions.length;
  const answered = total - r.open_questions;
  const late = daysLate(r.expected_response_date);
  const href = `/projects/${encodeURIComponent(r.project)}#rfi-section`;

  return (
    <div className={`rem-card rem-${band.key}`}>
      <div className="rem-days">
        <div className="rem-days-num">{r.days_pending}</div>
        <div className="rem-days-lbl">days waiting</div>
      </div>

      <div className="rem-body">
        <div className="rem-title">
          {r.rfi_number && <span className="rem-num">#{r.rfi_number}</span>}
          {r.title}
        </div>
        <div className="rem-meta">
          <a href={href} className="rem-project">
            <i className="bi bi-folder2-open" /> {r.project}
          </a>
          <span className="rfi-type-pill">{r.type}</span>
          <span className={`co-status-pill rfi-status-${r.status.toLowerCase()}`}>{r.status}</span>
        </div>
        <div className="rem-dates">
          <span>
            <i className="bi bi-send" /> Sent <b>{fmtDate(r.sent_date)}</b>
          </span>
          {r.expected_response_date ? (
            <span className={late ? "rem-late" : ""}>
              <i className="bi bi-calendar-event" /> Reply expected <b>{fmtDate(r.expected_response_date)}</b>
              {late > 0 && <> — {late} day{late === 1 ? "" : "s"} late</>}
            </span>
          ) : (
            <span className="rem-muted">
              <i className="bi bi-calendar-x" /> No expected reply date set
            </span>
          )}
        </div>
      </div>

      <div className="rem-side">
        {total > 0 ? (
          <div className="rem-progress" title={`${answered} of ${total} question(s) answered`}>
            <div className="rem-progress-lbl">
              <b>{answered}</b> of {total} answered
            </div>
            <div className="rem-progress-bar">
              <div style={{ width: `${(answered / total) * 100}%` }} />
            </div>
          </div>
        ) : (
          <div className="rem-muted rem-progress-lbl">No questions listed</div>
        )}
        <a href={href} className="btn btn-sm rem-open-btn">
          Open RFI <i className="bi bi-arrow-right" />
        </a>
      </div>
    </div>
  );
}

function CoApprovalCard({ co, isTeamLead }) {
  const href = `/projects/${encodeURIComponent(co.project)}#change-order-section`;
  return (
    <div className="rem-card rem-approval">
      <div className="rem-days">
        <div className="rem-days-num">{co.days_pending}</div>
        <div className="rem-days-lbl">days pending</div>
      </div>

      <div className="rem-body">
        <div className="rem-title">
          <span className="rem-num">CO{co.co_number}</span>
          {co.change_type}
        </div>
        <div className="rem-meta">
          <a href={href} className="rem-project">
            <i className="bi bi-folder2-open" /> {co.project}
          </a>
          <span className="co-status-pill co-approval-pending">
            <i className="bi bi-hourglass-split" /> AWAITING APPROVAL
          </span>
        </div>
        <div className="rem-dates">
          <span>
            <i className="bi bi-send" /> Submitted <b>{fmtDate(co.pending_since)}</b>
          </span>
          {!isTeamLead && (
            <span>
              <i className="bi bi-person" /> Raised by <b>{co.created_by || "—"}</b>
            </span>
          )}
          <span>
            <i className="bi bi-clock" /> {Number(co.hours ?? 0).toFixed(2)} hrs
          </span>
        </div>
      </div>

      <div className="rem-side">
        <a href={href} className="btn btn-sm rem-open-btn">
          {isTeamLead ? "Open CO" : "Review CO"} <i className="bi bi-arrow-right" />
        </a>
      </div>
    </div>
  );
}

function StatCard({ value, label, sub, tone, icon, active, onClick }) {
  return (
    <button type="button" className={`rem-stat rem-stat-${tone}${active ? " active" : ""}`} onClick={onClick}>
      <i className={`bi ${icon} rem-stat-icon`} />
      <div>
        <div className="rem-stat-num">{value}</div>
        <div className="rem-stat-lbl">{label}</div>
        {sub && <div className="rem-stat-sub">{sub}</div>}
      </div>
    </button>
  );
}

export default function RemindersPage() {
  const { data, isLoading, isFetching, refetch } = useRfiReminders();
  const { data: coData, isLoading: coLoading, isFetching: coFetching, refetch: refetchCos } = useCoApprovalReminders();
  const { user } = useAuth();
  const isTeamLead = user?.role === "team_lead";
  const reminders = data?.reminders || [];
  const coReminders = coData?.reminders || [];
  const threshold = data?.threshold_days ?? 5;
  const coThreshold = coData?.threshold_days ?? 5;

  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [view, setView] = useState("all"); // all | overdue | critical | co

  const projects = useMemo(
    () => [...new Set([...reminders, ...coReminders].map((r) => r.project))].sort(),
    [reminders, coReminders]
  );
  const overdueCount = reminders.filter((r) => r.status === "Overdue").length;
  const criticalCount = reminders.filter((r) => bandOf(r.days_pending).key === "critical").length;

  const filtered = reminders.filter((r) => {
    if (view === "co") return false;
    if (view === "overdue" && r.status !== "Overdue") return false;
    if (view === "critical" && bandOf(r.days_pending).key !== "critical") return false;
    if (project && r.project !== project) return false;
    if (search && !`${r.title} ${r.project} ${r.rfi_number}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredCos = coReminders.filter((co) => {
    if (view !== "all" && view !== "co") return false;
    if (project && co.project !== project) return false;
    if (search && !`CO${co.co_number} ${co.change_type} ${co.project} ${co.created_by}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const anyReminders = reminders.length > 0 || coReminders.length > 0;
  const hasFilters = search || project || view !== "all";
  function clearFilters() {
    setSearch("");
    setProject("");
    setView("all");
  }
  const toggleView = (v) => setView((cur) => (cur === v ? "all" : v));

  return (
    <AppLayout allow={["admin", "management", "team_lead"]}>
      <PageHero
        theme="navy"
        icon="bi-alarm-fill"
        title="Reminders"
        meta={
          isTeamLead
            ? "Your RFIs still waiting for a client reply, and your Change Orders still waiting for approval"
            : "RFIs still waiting for a client reply, and Change Orders still waiting for your approval"
        }
        right={
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => {
              refetch();
              refetchCos();
            }}
            disabled={isFetching || coFetching}
          >
            <i className={`bi bi-arrow-clockwise${isFetching || coFetching ? " rem-spin" : ""}`} /> Refresh
          </button>
        }
      />

      <div className="rem-info">
        <i className="bi bi-info-circle-fill" />
        <div>
          An RFI shows up here when it has been waiting <b>more than {threshold} days</b> for a reply. It disappears
          automatically once every question has a response date
          {isTeamLead ? (
            <> — use <b>Open RFI</b> to see it in the project; admin/management record the responses.</>
          ) : (
            <> — record responses from the project's RFI section using <b>Open RFI</b>.</>
          )}{" "}
          A team lead's Change Order shows up here when it has been waiting <b>more than {coThreshold} days</b> for
          approval, until it's approved or rejected.
        </div>
      </div>

      <div className="rem-stats">
        <StatCard
          value={reminders.length}
          label="Waiting for reply"
          sub={`across ${projects.length} project${projects.length === 1 ? "" : "s"}`}
          tone="total"
          icon="bi-hourglass-split"
          active={view === "all"}
          onClick={() => setView("all")}
        />
        <StatCard
          value={criticalCount}
          label="Critical"
          sub="waiting 15+ days"
          tone="critical"
          icon="bi-exclamation-octagon-fill"
          active={view === "critical"}
          onClick={() => toggleView("critical")}
        />
        <StatCard
          value={overdueCount}
          label="Past expected date"
          sub="reply date has passed"
          tone="overdue"
          icon="bi-calendar-x-fill"
          active={view === "overdue"}
          onClick={() => toggleView("overdue")}
        />
        <StatCard
          value={coReminders.length}
          label="CO approvals pending"
          sub={`waiting ${coThreshold}+ days`}
          tone="approval"
          icon="bi-shield-exclamation"
          active={view === "co"}
          onClick={() => toggleView("co")}
        />
      </div>

      {anyReminders && (
        <div className="rem-filters">
          <div className="rem-search">
            <i className="bi bi-search" />
            <input
              className="form-control form-control-sm"
              placeholder="Search by title, project, RFI # or CO #"
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
      )}

      {isLoading || coLoading ? (
        <div className="rem-empty">
          <div className="spinner-border spinner-border-sm text-secondary" /> Loading reminders…
        </div>
      ) : !anyReminders ? (
        <div className="rem-empty rem-empty-good">
          <i className="bi bi-check-circle-fill" />
          <div>
            <div className="rem-empty-title">All caught up!</div>
            <div>
              No RFI has been waiting more than {threshold} days for a reply, and no Change Order more than{" "}
              {coThreshold} days for approval.
            </div>
          </div>
        </div>
      ) : !filtered.length && !filteredCos.length ? (
        <div className="rem-empty">
          <i className="bi bi-funnel" /> No reminders match these filters.{" "}
          <button className="btn btn-sm btn-link p-0 align-baseline" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : (
        <>
          {filteredCos.length > 0 && (
            <section className="rem-group">
              <div className="rem-group-head rem-approval">
                <i className="bi bi-shield-exclamation" />
                <span className="rem-group-label">Change Orders awaiting approval</span>
                <span className="rem-group-hint">pending more than {coThreshold} days</span>
                <span className="rem-group-count">{filteredCos.length}</span>
              </div>
              {filteredCos.map((co) => (
                <CoApprovalCard key={co.id} co={co} isTeamLead={isTeamLead} />
              ))}
            </section>
          )}
          {BANDS.map((band) => {
          const rows = filtered.filter((r) => bandOf(r.days_pending).key === band.key);
          if (!rows.length) return null;
          return (
            <section key={band.key} className="rem-group">
              <div className={`rem-group-head rem-${band.key}`}>
                <i className={`bi ${band.icon}`} />
                <span className="rem-group-label">{band.label}</span>
                <span className="rem-group-hint">{band.hint}</span>
                <span className="rem-group-count">{rows.length}</span>
              </div>
              {rows.map((r) => (
                <ReminderCard key={r.id} r={r} />
              ))}
            </section>
          );
          })}
        </>
      )}
    </AppLayout>
  );
}
