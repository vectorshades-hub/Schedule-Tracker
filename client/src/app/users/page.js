"use client";
import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppLayout from "../../components/AppLayout";
import Modal from "../../components/Modal";
import PageHero from "../../components/PageHero";
import StatPill from "../../components/StatPill";
import UserRoleFields from "../../components/UserRoleFields";
import { api, ApiError, API_URL } from "../../lib/api";
import { useToast } from "../../lib/ToastContext";

const EMPTY_USER_FORM = { username: "", password: "", confirm_password: "", role: "team_lead", allowed_teams_chk: [], cross_team: "0", linked_tls_chk: [], default_tl_radio: "", bday_month: "", bday_day: "" };

export default function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users") });
  const users = data?.users || [];
  const teamLeadAndMgmt = users.filter((u) => ["team_lead", "management"].includes(u.role)).map((u) => u.username).sort();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const filtered = users.filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!`${u.username} ${u.role} ${u.allowed_teams.join(",")} ${u.linked_tls.join(",")}`.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_USER_FORM);
  async function submitAdd() {
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
      setAddOpen(false);
      setAddForm(EMPTY_USER_FORM);
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(`User "${addForm.username}" added.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to add user.");
    }
  }

  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState(null);
  function openEdit(u) {
    setEditingUser(u.username);
    setEditForm({
      username: u.username,
      password: "",
      role: u.role,
      allowed_teams_chk: u.allowed_teams,
      cross_team: u.cross_team ? "1" : "0",
      linked_tls_chk: u.linked_tls,
      default_tl_radio: u.default_tl,
      bday_month: u.birthday ? u.birthday.slice(0, 2) : "",
      bday_day: u.birthday ? u.birthday.slice(3, 5) : "",
    });
  }
  async function submitEdit() {
    try {
      await api.put(`/users/${editingUser}`, {
        edit_username: editForm.username,
        edit_password: editForm.password,
        edit_role: editForm.role,
        allowed_teams_chk: editForm.allowed_teams_chk,
        cross_team: editForm.cross_team,
        linked_tls_chk: editForm.linked_tls_chk,
        default_tl_radio: editForm.default_tl_radio,
        bday_month: editForm.bday_month,
        bday_day: editForm.bday_day,
      });
      setEditingUser(null);
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(`User "${editForm.username}" updated.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to update user.");
    }
  }

  const [deleteTarget, setDeleteTarget] = useState(null);
  async function confirmDeleteUser() {
    try {
      await api.delete(`/users/${deleteTarget}`);
      const deletedUser = deleteTarget;
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(`User "${deletedUser}" deleted.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to delete user.");
    }
  }

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  async function submitBulk() {
    try {
      const res = await api.post("/users/bulk-birthday", { bulk_data: bulkText });
      toast.success(`Updated: ${res.updated}, skipped (format): ${res.skipped_fmt}, skipped (unknown user): ${res.skipped_user}`);
      setBulkOpen(false);
      setBulkText("");
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed.");
    }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("users_file", file);
    try {
      const res = await api.post("/users/import", fd);
      toast.success(`Updated: ${res.updated}, skipped (unknown user): ${res.skipped_user}, skipped (invalid role): ${res.skipped_invalid}`);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e2) {
      toast.error(e2 instanceof ApiError ? e2.message : "Import failed.");
    }
    e.target.value = "";
  }

  const roleCounts = users.reduce((acc, u) => ((acc[u.role] = (acc[u.role] || 0) + 1), acc), {});

  return (
    <AppLayout allow={["admin"]}>
      <PageHero
        theme="emerald"
        icon="bi-people-fill"
        title="Users"
        meta={`${users.length} total`}
        right={
          <>
            <a className="btn btn-sm btn-light" href={`${API_URL}/users/export`} target="_blank" rel="noreferrer">
              <i className="bi bi-download" /> Export
            </a>
            <label className="btn btn-sm btn-light mb-0">
              <i className="bi bi-upload" /> Import
              <input type="file" hidden accept=".xlsx" onChange={handleImport} />
            </label>
            <button className="btn btn-sm btn-light" onClick={() => setBulkOpen(true)}>
              <i className="bi bi-calendar-event" /> Bulk Birthdays
            </button>
            <button className="btn btn-sm btn-warning" onClick={() => setAddOpen(true)}>
              <i className="bi bi-person-plus" /> Add User
            </button>
          </>
        }
      />

      <div className="stats-bar">
        <StatPill num={users.length} label="All" active={roleFilter === ""} onClick={() => setRoleFilter("")} />
        {["admin", "management", "team_lead", "qaqc", "user"].map((r) => (
          <StatPill key={r} num={roleCounts[r] || 0} label={r} active={roleFilter === r} onClick={() => setRoleFilter(r)} />
        ))}
      </div>

      <div className="filter-bar d-flex">
        <input className="form-control" style={{ maxWidth: 280 }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="ms-auto align-self-center text-muted small">{filtered.length} shown</span>
      </div>

      <div className="table-wrap theme-emerald">
        <table className="table table-sm mb-0">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Teams</th>
              <th>Cross Team</th>
              <th>Birthday</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const teams = u.role === "management" ? u.allowed_teams : u.role === "qaqc" || u.role === "user" ? u.linked_tls : [];
              return (
                <Fragment key={u.username}>
                  <tr>
                    <td>{u.username}</td>
                    <td><span className={`role-pill role-pill-${u.role}`}>{u.role}</span></td>
                    <td>{teams.length ? teams.join(", ") : "—"}</td>
                    <td>{u.role === "management" ? (u.cross_team ? "Yes" : "No") : "—"}</td>
                    <td>{u.birthday ? `🎂 ${u.birthday}` : "—"}</td>
                    <td>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => openEdit(u)}><i className="bi bi-pencil" /></button>
                      <button className="btn btn-sm btn-outline-danger ms-1" onClick={() => setDeleteTarget(u.username)}><i className="bi bi-trash" /></button>
                    </td>
                  </tr>
                  {editingUser === u.username && editForm && (
                    <tr>
                      <td colSpan={6} className="bg-light">
                        <div className="p-2" style={{ maxWidth: 480 }}>
                          <label className="form-label">Username</label>
                          <input className="form-control mb-2" value={editForm.username} onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))} />
                          <label className="form-label">New Password (blank = keep existing)</label>
                          <input type="password" className="form-control mb-2" value={editForm.password} onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))} />
                          <UserRoleFields form={editForm} setForm={setEditForm} teamLeadAndMgmtUsernames={teamLeadAndMgmt} />
                          <div className="d-flex gap-2 mt-2">
                            <button className="btn btn-primary" onClick={submitEdit}>Save</button>
                            <button className="btn btn-secondary" onClick={() => setEditingUser(null)}>Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add User"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setAddOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitAdd}>Add</button>
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

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete User"
        theme="danger"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={confirmDeleteUser}>Delete</button>
          </>
        }
      >
        <p>Delete user &quot;{deleteTarget}&quot;? This cannot be undone.</p>
      </Modal>

      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk Birthdays"
        theme="bulkBirthday"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setBulkOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitBulk}>Submit</button>
          </>
        }
      >
        <p className="text-muted small">One per line: <code>username,MM-DD</code>. Blank date clears the birthday.</p>
        <textarea className="form-control" rows={8} value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
      </Modal>
    </AppLayout>
  );
}
