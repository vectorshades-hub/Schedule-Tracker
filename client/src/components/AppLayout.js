"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/AuthContext";
import NotificationBell from "./NotificationBell";
import Modal from "./Modal";
import UserRoleFields from "./UserRoleFields";
import { api, ApiError } from "../lib/api";
import { ROLE_BADGE_STYLES } from "../lib/statusStyles";
import { useToast } from "../lib/ToastContext";

const EMPTY_USER_FORM = { username: "", password: "", confirm_password: "", role: "team_lead", allowed_teams_chk: [], cross_team: "0", linked_tls_chk: [], default_tl_radio: "", bday_month: "", bday_day: "" };

/**
 * Persistent role-aware layout — the React equivalent of base.html's navbar +
 * role-conditional nav links. Wrap every authenticated page in this.
 * `allow` (optional array of roles) redirects to /login (not authenticated)
 * or back to the dashboard (wrong role) — mirrors Flask's `login_required`
 * plus the many inline `if session.get("role") not in (...)` checks.
 */
export default function AppLayout({ children, allow }) {
  const { user, loading, logout } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_USER_FORM);
  const [teamLeadAndMgmt, setTeamLeadAndMgmt] = useState([]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (allow && !allow.includes(user.role)) {
      router.replace("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  useEffect(() => {
    if (!addUserOpen || !user || user.role !== "admin") return;
    api.get("/users").then((d) => {
      setTeamLeadAndMgmt(d.users.filter((u) => ["team_lead", "management"].includes(u.role)).map((u) => u.username).sort());
    });
  }, [addUserOpen, user]);

  async function submitAddUser() {
    try {
      await api.post("/users", {
        new_username: addForm.username,
        new_password: addForm.password,
        confirm_password: addForm.confirm_password,
        new_role: addForm.role,
        allowed_teams_chk: addForm.allowed_teams_chk,
        cross_team: addForm.cross_team,
        linked_tls_chk: addForm.linked_tls_chk,
        default_tl_radio: addForm.default_tl_radio,
        bday_month: addForm.bday_month,
        bday_day: addForm.bday_day,
      });
      setAddUserOpen(false);
      setAddForm(EMPTY_USER_FORM);
      toast.success(`User "${addForm.username}" added.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to add user.");
    }
  }

  if (loading || !user || (allow && !allow.includes(user.role))) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: "100vh" }}>
        <div className="spinner-border text-secondary" role="status" />
      </div>
    );
  }

  const role = user.role;
  const roleStyle = ROLE_BADGE_STYLES[role] || ROLE_BADGE_STYLES.user;

  return (
    <div className="d-flex flex-column" style={{ minHeight: "100vh" }}>
      <nav className="st-navbar">
        <a href="/" className="d-flex align-items-center gap-2 text-decoration-none">
          <img
            src="/logo.png"
            alt="Vectorshades"
            className="st-brand-logo"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <span className="st-brand-text">
            <span className="st-brand-title">Schedule Tracker</span>
            <span className="st-brand-sub">Vectorshades LLC</span>
          </span>
        </a>

        <div className="d-flex align-items-center gap-3 ms-auto">
          <span className="d-flex align-items-center gap-1">
            <i className="bi bi-person-circle" /> {user.username}
            <span className="badge" style={{ background: roleStyle.bg, color: roleStyle.fg, fontSize: "0.65rem" }}>
              {role.toUpperCase()}
            </span>
          </span>

          {role === "admin" && (
            <a href="#" onClick={(e) => { e.preventDefault(); setAddUserOpen(true); }}>
              <i className="bi bi-person-plus-fill" /> Add User
            </a>
          )}
          {role === "admin" && <a href="/users"><i className="bi bi-people-fill" /> Users</a>}
          {role === "admin" && <a href="/bulk-upload"><i className="bi bi-cloud-upload-fill" /> Bulk Upload</a>}
          {role === "admin" && <a href="/activity-log"><i className="bi bi-clipboard-data-fill" /> Activity Log</a>}
          {role === "admin" && <a href="/settings"><i className="bi bi-gear-fill" /> Settings</a>}
          {["admin", "management", "team_lead"].includes(role) && (
            <>
              <a href="/projects"><i className="bi bi-folder-fill" /> Projects</a>
              <a href="/completed-log"><i className="bi bi-check2-square" /> Completed Log</a>
            </>
          )}
          {["admin", "management", "team_lead", "qaqc", "user"].includes(role) && (
            <a href="/editing-log"><i className="bi bi-pencil-square" /> Editing Log</a>
          )}
          {["admin", "management"].includes(role) && <a href="/reports"><i className="bi bi-file-earmark-bar-graph-fill" /> Reports</a>}
          {(["admin", "management"].includes(role) || user.can_edit_invoice_released) && (
            <a href="/management-dashboard"><i className="bi bi-graph-up-arrow" /> Management Dashboard</a>
          )}
          {["admin", "finance"].includes(role) && (
            <a href="/finance-dashboard"><i className="bi bi-cash-coin" /> Finance Dashboard</a>
          )}
          {role === "admin" && <a href="/request-log"><i className="bi bi-hdd-network-fill" /> Request Log</a>}

          <div className="ms-auto d-flex align-items-center gap-3">
            {["admin", "management"].includes(role) && <NotificationBell />}
            <button className="btn btn-sm btn-outline-light" onClick={logout}>
              <i className="bi bi-box-arrow-right" /> Logout
            </button>
          </div>
        </div>
      </nav>
      <main className="p-3 flex-fill">{children}</main>
      <footer className="st-footer">
        &copy; {new Date().getFullYear()} Vectorshades LLC. All rights reserved.
        <span className="st-footer-sep">|</span>
        <i className="bi bi-lightning-charge-fill st-footer-bolt" /> Developed by R &amp; D Department, Vectorshades LLC
      </footer>

      {role === "admin" && (
        <Modal
          open={addUserOpen}
          onClose={() => setAddUserOpen(false)}
          title="Add User"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setAddUserOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitAddUser}>Add</button>
            </>
          }
        >
          <label className="form-label">Username</label>
          <input className="form-control mb-2" value={addForm.username} onChange={(e) => setAddForm((f) => ({ ...f, username: e.target.value }))} />
          <label className="form-label">Password</label>
          <input type="password" className="form-control mb-2" value={addForm.password} onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))} />
          <label className="form-label">Confirm Password</label>
          <input type="password" className="form-control mb-2" value={addForm.confirm_password} onChange={(e) => setAddForm((f) => ({ ...f, confirm_password: e.target.value }))} />
          <UserRoleFields form={addForm} setForm={setAddForm} teamLeadAndMgmtUsernames={teamLeadAndMgmt} />
        </Modal>
      )}
    </div>
  );
}
