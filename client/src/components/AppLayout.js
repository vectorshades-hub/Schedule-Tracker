"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/AuthContext";
import NotificationBell from "./NotificationBell";
import Modal from "./Modal";
import ReportsExportModal from "./ReportsExportModal";
import BackupModal from "./BackupModal";
import UserRoleFields from "./UserRoleFields";
import { api, ApiError } from "../lib/api";
import { ROLE_BADGE_STYLES } from "../lib/statusStyles";
import { useToast } from "../lib/ToastContext";

/**
 * Admin-only "⋮" overflow menu in the navbar — holds the less-used admin
 * links (Users, Add User, Bulk Upload, Activity Log, Request Log, Backup) so the
 * top bar stays on one line. Closes on outside click, Escape, or picking an item.
 */
function AdminMoreMenu({ onAddUser, onBackup }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="st-more" ref={ref}>
      <button
        type="button"
        className="st-more-btn"
        aria-label="More admin options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <i className="bi bi-three-dots-vertical" />
      </button>
      {open && (
        <div className="st-more-menu" role="menu">
          <a href="/users" role="menuitem"><i className="bi bi-people-fill" /> Users</a>
          <a href="#" role="menuitem" onClick={(e) => { e.preventDefault(); setOpen(false); onAddUser(); }}>
            <i className="bi bi-person-plus-fill" /> Add User
          </a>
          <a href="/bulk-upload" role="menuitem"><i className="bi bi-cloud-upload-fill" /> Bulk Upload</a>
          <a href="/activity-log" role="menuitem"><i className="bi bi-clipboard-data-fill" /> Activity Log</a>
          <a href="/request-log" role="menuitem"><i className="bi bi-hdd-network-fill" /> Request Log</a>
          <a href="#" role="menuitem" onClick={(e) => { e.preventDefault(); setOpen(false); onBackup(); }}>
            <i className="bi bi-database-fill-down" /> Backup
          </a>
        </div>
      )}
    </div>
  );
}

const EMPTY_USER_FORM ={ username: "", password: "", confirm_password: "", role: "team_lead", allowed_teams_chk: [], cross_team: "0", linked_tls_chk: [], default_tl_radio: "", bday_month: "", bday_day: "" };

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
  const [reportsOpen, setReportsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);

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
          {["admin", "management", "team_lead"].includes(role) && (
            <a href="#" onClick={(e) => { e.preventDefault(); setReportsOpen(true); }}>
              <i className="bi bi-file-earmark-bar-graph-fill" /> Reports
            </a>
          )}
          {(["admin", "management"].includes(role) || user.can_edit_invoice_released) && (
            <a href="/management-dashboard"><i className="bi bi-graph-up-arrow" /> Management Dashboard</a>
          )}
          {["admin", "finance"].includes(role) && (
            <a href="/finance-dashboard"><i className="bi bi-cash-coin" /> Finance Dashboard</a>
          )}
          <div className="ms-auto d-flex align-items-center gap-3">
            {["admin", "management"].includes(role) && <NotificationBell />}
            {role === "team_lead" && <NotificationBell remindersOnly />}
            {role === "admin" && <AdminMoreMenu onAddUser={() => setAddUserOpen(true)} onBackup={() => setBackupOpen(true)} />}
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

      {role === "admin" && <BackupModal open={backupOpen} onClose={() => setBackupOpen(false)} />}

      {["admin", "management", "team_lead"].includes(role) && (
        <ReportsExportModal open={reportsOpen} onClose={() => setReportsOpen(false)} role={role} />
      )}
    </div>
  );
}
