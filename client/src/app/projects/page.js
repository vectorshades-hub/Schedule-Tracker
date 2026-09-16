"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppLayout from "../../components/AppLayout";
import PageHero from "../../components/PageHero";
import ClientModal from "../../components/ClientModal";
import ProjectModal from "../../components/ProjectModal";
import { api, ApiError } from "../../lib/api";
import { useToast } from "../../lib/ToastContext";

const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#0f766e", "#c2410c", "#be185d", "#4d7c0f", "#0369a1"];

function avatarColor(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

/**
 * One client's card: a collapsible header (colored initials avatar, name,
 * project-count badge) over its projects, shown as a chip grid rather than
 * a dense table — scanning "which projects does this client have" is the
 * whole point of this page, so each card leads with that answer and tucks
 * rename/delete behind quiet icon buttons instead of bordered ones.
 */
function ClientCard({ name, projects, isUnassigned, open, onToggle, onEditClient, onDeleteClient, onAddProject, onEditProject, onDeleteProject }) {
  return (
    <div className="pm-client-card">
      <div className="pm-client-head" onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onToggle()}>
        <div className="pm-client-head-left">
          <i className={`bi bi-chevron-down pm-client-chevron${open ? "" : " collapsed"}`} />
          {isUnassigned ? (
            <span className="pm-client-icon pm-client-icon-muted">
              <i className="bi bi-question-circle-fill" />
            </span>
          ) : (
            <span className="avatar-circle" style={{ background: avatarColor(name) }}>{initials(name)}</span>
          )}
          <div className="pm-client-name">
            {isUnassigned ? "Unassigned" : name}
            <span className="dp-count-badge">{projects.length}</span>
          </div>
        </div>
        {!isUnassigned && (
          <div className="pm-client-actions" onClick={(e) => e.stopPropagation()}>
            <button className="pm-icon-btn" title="Rename client" onClick={() => onEditClient(name)}>
              <i className="bi bi-pencil" />
            </button>
            <button className="pm-icon-btn pm-icon-btn-danger" title="Delete client" onClick={() => onDeleteClient(name, projects.length)}>
              <i className="bi bi-trash" />
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="pm-client-body">
          {projects.length ? (
            <div className="pm-project-grid">
              {projects.map((p) => (
                <div key={p.name} className="pm-project-chip">
                  <i className="bi bi-folder-fill" />
                  <span>{p.name}</span>
                  <span className="pm-project-chip-actions">
                    <button className="pm-icon-btn" title="Rename / move project" onClick={() => onEditProject(p)}>
                      <i className="bi bi-pencil" />
                    </button>
                    <button className="pm-icon-btn pm-icon-btn-danger" title="Delete project" onClick={() => onDeleteProject(p.name)}>
                      <i className="bi bi-trash" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="pm-empty-projects">
              <i className="bi bi-inbox" /> No projects {isUnassigned ? "" : "for this client "}yet.
            </div>
          )}
          {!isUnassigned && (
            <button className="pm-add-project-link" onClick={onAddProject}>
              <i className="bi bi-plus-lg" /> Add project to {name}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ManageProjectsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ["projects-master"], queryFn: () => api.get("/projects") });
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set()); // client names the user has manually collapsed

  const [clientModal, setClientModal] = useState(null); // { name } to edit, or {} to add
  const [projectModal, setProjectModal] = useState(null); // { initial?: {name,client}, presetClient? } or null
  const [deleteTarget, setDeleteTarget] = useState(null); // { kind: "project" | "client", name, projectCount? }
  const [deletePassword, setDeletePassword] = useState("");

  const clients = data?.clients || [];
  const projectDetails = data?.projectDetails || [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["projects-master"] });
  }

  function toggleCollapsed(name) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Group projects under their client; anything whose client is blank or no
  // longer exists (deleted client) falls into a dedicated "Unassigned" card
  // rather than disappearing — only shown when it actually has projects.
  const clientNameSet = new Set(clients);
  const groups = clients.map((c) => ({ name: c, projects: projectDetails.filter((p) => p.client === c) }));
  const unassignedProjects = projectDetails.filter((p) => !p.client || !clientNameSet.has(p.client));

  const q = search.trim().toLowerCase();
  function groupMatches(groupName, projects) {
    if (!q) return true;
    if (groupName.toLowerCase().includes(q)) return true;
    return projects.some((p) => p.name.toLowerCase().includes(q));
  }
  function visibleProjects(groupName, projects) {
    if (!q || groupName.toLowerCase().includes(q)) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }
  // A search should always reveal its matches, even inside a card the user
  // collapsed earlier — collapse state only applies with no active search.
  function isOpen(name) {
    return !!q || !collapsed.has(name);
  }

  const visibleGroups = groups.filter((g) => groupMatches(g.name, g.projects));
  const showUnassigned = unassignedProjects.length > 0 && groupMatches("Unassigned", unassignedProjects);
  const visibleUnassigned = visibleProjects("Unassigned", unassignedProjects);

  async function handleSaveClient(name) {
    const isEdit = !!clientModal?.name;
    setBusy(true);
    try {
      if (isEdit) {
        await api.post("/projects", { action: "edit_client", old_name: clientModal.name, new_name: name });
        toast.success(`Client renamed to "${name}".`);
      } else {
        await api.post("/projects", { action: "add_client", client_name: name });
        toast.success(`Client "${name}" added.`);
      }
      setClientModal(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save client.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveProject({ name, client }) {
    const isEdit = !!projectModal?.initial;
    setBusy(true);
    try {
      if (isEdit) {
        await api.post("/projects", { action: "edit", old_name: projectModal.initial.name, new_name: name, client_name: client });
        toast.success(`Project "${name}" updated.`);
      } else {
        await api.post("/projects", { action: "add", project_name: name, client_name: client });
        toast.success(`Project "${name}" added under "${client}".`);
      }
      setProjectModal(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save project.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    try {
      if (deleteTarget.kind === "client") {
        await api.post("/projects", { action: "delete_client", client_name: deleteTarget.name, delete_password: deletePassword });
      } else {
        await api.post("/projects", { action: "delete", project_name: deleteTarget.name, delete_password: deletePassword });
      }
      const { kind, name } = deleteTarget;
      setDeleteTarget(null);
      setDeletePassword("");
      invalidate();
      toast.success(`${kind === "client" ? "Client" : "Project"} "${name}" deleted.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to delete.");
    }
  }

  return (
    <AppLayout allow={["admin", "management", "team_lead"]}>
      <PageHero
        theme="navyblue"
        icon="bi-diagram-3-fill"
        title="Manage Projects & Clients"
        meta={`${clients.length} client${clients.length === 1 ? "" : "s"} · ${projectDetails.length} project${projectDetails.length === 1 ? "" : "s"}`}
      />

      <div className="pm-toolbar">
        <div className={`pm-input-icon${search ? " pm-clearable" : ""}`}>
          <i className="bi bi-search" />
          <input className="form-control" placeholder="Search clients or projects…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button type="button" className="pm-clear-btn" aria-label="Clear search" onClick={() => setSearch("")}>
              <i className="bi bi-x-circle-fill" />
            </button>
          )}
        </div>
        <span className="pm-search-count">
          Showing {visibleGroups.length} of {clients.length} client{clients.length === 1 ? "" : "s"}
          {unassignedProjects.length > 0 && ` · ${unassignedProjects.length} unassigned`}
        </span>
        <div className="pm-toolbar-actions">
          <button className="btn btn-outline-primary text-nowrap" onClick={() => setClientModal({})}>
            <i className="bi bi-building" /> Add Client
          </button>
          <button className="btn btn-primary text-nowrap" onClick={() => setProjectModal({})} disabled={!clients.length}>
            <i className="bi bi-plus-lg" /> Add Project
          </button>
        </div>
      </div>
      {!clients.length && <p className="text-muted small mb-3"><i className="bi bi-info-circle" /> Add a client first — every project needs one.</p>}

      <div className="pm-client-list">
        {visibleGroups.map((g) => (
          <ClientCard
            key={g.name}
            name={g.name}
            projects={visibleProjects(g.name, g.projects)}
            open={isOpen(g.name)}
            onToggle={() => toggleCollapsed(g.name)}
            onEditClient={(name) => setClientModal({ name })}
            onDeleteClient={(name, projectCount) => setDeleteTarget({ kind: "client", name, projectCount })}
            onAddProject={() => setProjectModal({ presetClient: g.name })}
            onEditProject={(p) => setProjectModal({ initial: p })}
            onDeleteProject={(name) => setDeleteTarget({ kind: "project", name })}
          />
        ))}

        {showUnassigned && (
          <ClientCard
            name="Unassigned"
            isUnassigned
            projects={visibleUnassigned}
            open={isOpen("Unassigned")}
            onToggle={() => toggleCollapsed("Unassigned")}
            onEditProject={(p) => setProjectModal({ initial: p })}
            onDeleteProject={(name) => setDeleteTarget({ kind: "project", name })}
          />
        )}

        {!visibleGroups.length && !showUnassigned && clients.length > 0 && (
          <div className="empty-state"><i className="bi bi-search" />No clients or projects match &quot;{search}&quot;.</div>
        )}
        {!clients.length && (
          <div className="empty-state"><i className="bi bi-inbox" />No clients yet — add one above to get started.</div>
        )}
      </div>

      <p className="text-muted small mt-2">
        <i className="bi bi-info-circle" /> Deleting a client unassigns its projects (they move to “Unassigned” instead of being deleted). Deleting a project or client never touches existing records.
      </p>

      <ClientModal
        open={!!clientModal}
        initial={clientModal?.name ? clientModal : null}
        submitting={busy}
        onClose={() => setClientModal(null)}
        onSubmit={handleSaveClient}
      />

      <ProjectModal
        open={!!projectModal}
        initial={projectModal?.initial || null}
        presetClient={projectModal?.presetClient}
        clients={clients}
        submitting={busy}
        onClose={() => setProjectModal(null)}
        onSubmit={handleSaveProject}
      />

      {deleteTarget && (
        <div className="st-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDeleteTarget(null)}>
          <div className="st-modal" style={{ maxWidth: 420 }}>
            <div className="st-modal-header header-danger"><h5 className="m-0">Delete &quot;{deleteTarget.name}&quot;</h5></div>
            <div className="st-modal-body">
              {deleteTarget.kind === "client" && deleteTarget.projectCount > 0 && (
                <p className="text-muted small">
                  {deleteTarget.projectCount} project{deleteTarget.projectCount === 1 ? "" : "s"} under this client will become Unassigned.
                </p>
              )}
              <input type="password" className="form-control" placeholder="Delete password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
            </div>
            <div className="st-modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
