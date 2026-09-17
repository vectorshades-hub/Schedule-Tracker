"use client";
import { useEffect, useState } from "react";
import { useToast } from "../lib/ToastContext";
import { api, ApiError, API_URL } from "../lib/api";
import { useDashboardConfig } from "../hooks/useRecords";
import {
  useChangeOrders,
  useCreateChangeOrder,
  useUpdateChangeOrder,
  useDeleteChangeOrder,
  useSetChangeOrderApproval,
  useToggleChangeOrderBilled,
} from "../hooks/useChangeOrders";
import { useRfis, useCreateRfi, useUpdateRfi, useDeleteRfi, useSetRfiResponseReceived } from "../hooks/useRfis";
import { useProjectActivity } from "../hooks/useActivityLog";
import {
  computeProjectLifecycle,
  buildCombinedActivity,
  mostCommonValue,
  fmtDateLong,
  fmtDateTimeLong,
  parseDate,
  clusterByDate,
  OFA_TYPES,
  FAB_TYPES,
} from "../lib/projectLifecycle";
import StatusBadge from "./StatusBadge";
import Modal from "./Modal";
import CreateChangeOrderModal from "./CreateChangeOrderModal";
import ChangeOrderCard from "./ChangeOrderCard";
import CreateRfiModal from "./CreateRfiModal";
import RfiCard from "./RfiCard";
import ImageLightboxModal from "./ImageLightboxModal";

/** A color-coded icon + title(+count)/subtitle + optional action buttons —
 * every panel below uses this so each section reads as its own distinct
 * "card" at a glance instead of a wall of identical blue bars. */
function PanelHeader({ icon, color, title, subtitle, count, actions }) {
  return (
    <div className={`detail-panel-header dp-header-${color}`}>
      <div className="dp-header-row">
        <div className="dp-header-left">
          <span className={`dp-icon dp-icon-${color}`}>
            <i className={`bi ${icon}`} />
          </span>
          <div>
            <div className="dp-header-title">
              {title}
              {count != null && <span className="dp-count-badge">{count}</span>}
            </div>
            {subtitle && <div className="dp-header-subtitle">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="dp-header-actions">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * The project's cover image — drag/drop, paste, or click to upload (canEdit
 * only), and click the thumbnail to open it full-size in ImageLightboxModal.
 * Uploads go straight to the server (POST /api/projects/:name/image) rather
 * than staging like the record-level hold attachment does, since there's no
 * surrounding form submit to piggyback on here.
 */
function ProjectImagePanel({ projectName, imageFilename, canEdit, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const inputId = "project-image-input";

  useEffect(() => {
    if (!canEdit) return;
    function onPaste(e) {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (item) handleFile(item.getAsFile());
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, projectName]);

  async function handleFile(file) {
    if (!file || !projectName || busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      await api.post(`/projects/${encodeURIComponent(projectName)}/image`, fd);
      toast.success("Project image updated.");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to upload image.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(e) {
    e.stopPropagation();
    if (!projectName || busy) return;
    setBusy(true);
    try {
      await api.post(`/projects/${encodeURIComponent(projectName)}/image/delete`, {});
      toast.success("Project image removed.");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to remove image.");
    } finally {
      setBusy(false);
    }
  }

  const imageUrl = imageFilename ? `${API_URL}/projects/image/${imageFilename}` : "";

  return (
    <>
      <div className="detail-panel">
        <PanelHeader icon="bi-image-fill" color="rose" title="Project Image" subtitle="Cover photo or reference image for this project" />
        <div className="detail-panel-body">
          {imageUrl ? (
            <div className="project-image-preview" onClick={() => setLightboxOpen(true)} title="Click to view full size">
              <img src={imageUrl} alt="Project" />
              {canEdit && (
                <div className="project-image-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      document.getElementById(inputId)?.click();
                    }}
                  >
                    <i className="bi bi-arrow-repeat" /> Replace
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-danger" disabled={busy} onClick={handleRemove}>
                    <i className="bi bi-trash" /> Remove
                  </button>
                </div>
              )}
            </div>
          ) : canEdit ? (
            <div
              className="project-image-dropzone"
              onClick={() => document.getElementById(inputId)?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFile(e.dataTransfer.files?.[0]);
              }}
            >
              <i className="bi bi-cloud-arrow-up fs-2" />
              <div>{busy ? "Uploading…" : "Drag & drop, paste (Ctrl+V), or click to choose an image"}</div>
            </div>
          ) : (
            <div className="empty-state">
              <i className="bi bi-image" />
              <div>No project image yet</div>
            </div>
          )}
          {canEdit && (
            <input id={inputId} type="file" accept="image/*" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
          )}
        </div>
      </div>
      <ImageLightboxModal open={lightboxOpen} onClose={() => setLightboxOpen(false)} src={imageUrl} title={projectName} />
    </>
  );
}

/**
 * A project's "lifecycle" header + summary panels, shown at the top of its
 * project page (`records` holds every submission for that project). It's
 * built on top of lib/projectLifecycle.js's generic (Project Received / OFA
 * – Issued for Approval / Fabrication / Completed) stage rules: the OFA and
 * Fabrication stages are each reached — and dated/badged — by that project's
 * most recent submission whose type falls in the matching group (see
 * OFA_TYPES/FAB_TYPES in projectLifecycle.js). Milestone stays a
 * placeholder — this app has no backing feature for it yet, so it explains
 * that up front instead of pretending to save something — but Change Orders
 * and RFI/Clarification are both real, backed by their own collections
 * (scoped by project — see server/src/models/ChangeOrder.js and Rfi.js).
 */
export default function SubmissionOverview({
  records,
  canEdit,
  canDelete = false,
  canDeleteChangeOrders = false,
  canDeleteRfis = false,
  projectCompleted = false,
  projectCompletedAt = "",
  onMarkProjectCompleted,
  ofaCompleted = false,
  ofaCompletedAt = "",
  onMarkOfaCompleted,
  fabCompleted = false,
  fabCompletedAt = "",
  onMarkFabCompleted,
  projectImageFilename = "",
  onProjectImageChanged,
  onEditRecord,
  onDeleteRecord,
}) {
  const toast = useToast();
  const [coModalOpen, setCoModalOpen] = useState(false);
  const [editingCO, setEditingCO] = useState(null); // the CO row being edited, or null (create mode)
  const [deleteTargetCO, setDeleteTargetCO] = useState(null);
  const [rfiModalOpen, setRfiModalOpen] = useState(false);
  const [editingRfi, setEditingRfi] = useState(null); // the RFI row being edited, or null (create mode)
  const [deleteTargetRfi, setDeleteTargetRfi] = useState(null);
  const [rfiFilter, setRfiFilter] = useState("All"); // "All" | "Pending" | "Overdue" | "Returned"
  const [coFilter, setCoFilter] = useState("All"); // "All" | "Pending" | "Approved" | "Rejected" | "Billed"
  const [subTypeFilter, setSubTypeFilter] = useState(""); // "" (all) or a submission_type
  const [subCompletedFilter, setSubCompletedFilter] = useState(""); // "" (all) | "Completed" | "Not Completed"
  const [pendingAction, setPendingAction] = useState(null); // { title, message, run } — confirm before Approve/Reject/Billed/Response toggles
  const [dotPopup, setDotPopup] = useState(null); // { date, records } — the timeline dot's details popup, or null
  const projectName = records[0]?.project || "";
  const { data: coData, refetch: refetchCOs } = useChangeOrders(projectName);
  const createCO = useCreateChangeOrder();
  const updateCO = useUpdateChangeOrder();
  const deleteCO = useDeleteChangeOrder();
  const setCOApproval = useSetChangeOrderApproval();
  const toggleCOBilled = useToggleChangeOrderBilled();
  const { data: coDashboardConfig } = useDashboardConfig({});
  const { data: rfiData, refetch: refetchRfis } = useRfis(projectName);
  const createRfi = useCreateRfi();
  const updateRfi = useUpdateRfi();
  const deleteRfi = useDeleteRfi();
  const setRfiResponse = useSetRfiResponseReceived();
  const { data: deletedActivityData } = useProjectActivity(projectName);
  const lifecycle = computeProjectLifecycle(records);
  if (!lifecycle) return null;
  const { stages, currentIndex, gaps, avgPct } = lifecycle;
  // Stage anchors sit inset from the track's edges (not flush at 0%/100%) so
  // each circle+label column has room either side without spilling out of the card.
  const INSET = 10;
  const SPAN = 100 - INSET * 2;
  const posFor = (i) => (stages.length > 1 ? INSET + (i / (stages.length - 1)) * SPAN : 50);

  // Every individual submission is plotted as its own dot along the segment
  // for the type-group it belongs to — OFA/REAPPROVAL/FOR REVIEW between
  // Project Received and OFA, FAB/FIELD USE/REVISION between OFA and
  // Fabrication — rather than only the one latest record each segment's
  // stage circle already summarizes. Same-day submissions share a single dot
  // (its popup lists all of them); dots are then spaced evenly, in date
  // order, along their segment's width.
  const ofaDots = clusterByDate(records, OFA_TYPES);
  const fabDots = clusterByDate(records, FAB_TYPES);

  // Submissions in each group that aren't actually completed yet (their own
  // real status/tag, not the separate per-record "type complete" marker) —
  // surfaced as a warning in the Complete OFA/Fabrication confirm modal, but
  // never blocking it: both stay fully manual either way.
  const ofaIncomplete = ofaDots.flatMap((c) => c.records).filter((r) => !(r.tag || "").startsWith("completed"));
  const fabIncomplete = fabDots.flatMap((c) => c.records).filter((r) => !(r.tag || "").startsWith("completed"));

  function dotPositions(clusters, segStart, segEnd) {
    return clusters.map((cluster, i) => ({
      cluster,
      left: segStart + ((i + 1) / (clusters.length + 1)) * (segEnd - segStart),
    }));
  }

  const changeOrders = coData?.change_orders || [];

  function openCreateCO() {
    setEditingCO(null);
    setCoModalOpen(true);
  }

  function openEditCO(co) {
    setEditingCO(co);
    setCoModalOpen(true);
  }

  async function submitChangeOrder(form) {
    const payload = {
      project: projectName,
      co_number: form.co_number,
      team: form.team,
      date: form.date,
      change_type: form.change_type,
      notes: form.notes,
      hours: form.hours,
      approval: form.approval,
      billed: form.billed,
      currency: form.currency,
      amount: form.amount,
    };
    try {
      const res = editingCO
        ? await updateCO.mutateAsync({ id: editingCO.id, data: payload })
        : await createCO.mutateAsync(payload);
      toast.success(res.message || `Change Order #${form.co_number} ${editingCO ? "updated" : "created"}.`);
      setCoModalOpen(false);
      setEditingCO(null);
      refetchCOs();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save change order.");
    }
  }

  async function confirmDeleteCO() {
    try {
      const res = await deleteCO.mutateAsync({ id: deleteTargetCO.id });
      toast.success(res.message || `Change Order #${deleteTargetCO.co_number} deleted.`);
      setDeleteTargetCO(null);
      refetchCOs();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to delete change order.");
    }
  }

  // Approve/Reject, Billed, and RFI Response Received all go through this one
  // confirm step before actually calling the API — see `pendingAction` state
  // and the shared confirm Modal near the end of this component. `warning`
  // is optional extra text (e.g. "N submissions aren't completed yet") shown
  // in its own highlighted paragraph — used by the OFA/Fabrication/Project
  // completion confirms, which are manual and never blocked by it.
  function requestConfirm(title, message, run, warning) {
    setPendingAction({ title, message, run, warning });
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    await pendingAction.run();
    setPendingAction(null);
  }

  async function handleSetApproval(co, approval) {
    try {
      await setCOApproval.mutateAsync({ id: co.id, approval });
      toast.success(`Change Order #${co.co_number} marked ${approval.toLowerCase()}.`);
      refetchCOs();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to update approval.");
    }
  }

  function confirmSetApproval(co, approval) {
    requestConfirm(
      `Mark ${approval}`,
      `Mark Change Order #${co.co_number} (${co.change_type}) as ${approval}?`,
      () => handleSetApproval(co, approval)
    );
  }

  async function handleToggleBilled(co, billed) {
    try {
      await toggleCOBilled.mutateAsync({ id: co.id, billed });
      refetchCOs();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to update billed status.");
    }
  }

  function confirmToggleBilled(co, billed) {
    requestConfirm(
      billed ? "Mark Billed" : "Mark Not Billed",
      `Mark Change Order #${co.co_number} as ${billed ? "billed" : "not billed"}?`,
      () => handleToggleBilled(co, billed)
    );
  }

  function exportChangeOrdersCSV() {
    const headers = ["CO #", "Team", "Change", "Notes", "Date", "Hours", "Approval", "Billed", "Created By"];
    const rows = changeOrders.map((co) => [
      co.co_number,
      co.team,
      co.change_type,
      co.notes,
      co.date,
      co.hours,
      co.approval,
      co.billed ? "Yes" : "No",
      co.created_by,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `change-orders-${projectName || "project"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const rfis = rfiData?.rfis || [];
  const deletedEvents = deletedActivityData?.entries || [];
  const filteredRfis = rfiFilter === "All" ? rfis : rfis.filter((r) => r.status === rfiFilter);
  const submissionTypes = [...new Set(records.map((r) => r.submission_type).filter(Boolean))].sort();
  const sortedSubmissions = [...records].sort((a, b) => {
    const da = parseDate(a.sub_date_raw);
    const db = parseDate(b.sub_date_raw);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });
  const filteredSubmissions = sortedSubmissions.filter((r) => {
    if (subTypeFilter && r.submission_type !== subTypeFilter) return false;
    const completed = (r.tag || "").startsWith("completed");
    if (subCompletedFilter === "Completed" && !completed) return false;
    if (subCompletedFilter === "Not Completed" && completed) return false;
    return true;
  });
  const filteredChangeOrders =
    coFilter === "All" ? changeOrders : coFilter === "Billed" ? changeOrders.filter((co) => co.billed) : changeOrders.filter((co) => co.approval === coFilter);

  function exportRfisCSV() {
    const headers = ["Type", "Title", "Description", "RFI Date", "Expected Response", "Actual Return", "Status", "Created By"];
    const rows = rfis.map((r) => [
      r.type,
      r.title,
      r.description,
      r.date,
      r.expected_response_date,
      r.actual_return_date,
      r.status,
      r.created_by,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rfis-${projectName || "project"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openCreateRfi() {
    setEditingRfi(null);
    setRfiModalOpen(true);
  }

  function openEditRfi(rfi) {
    setEditingRfi(rfi);
    setRfiModalOpen(true);
  }

  async function submitRfi(form) {
    const payload = {
      project: projectName,
      type: form.type,
      title: form.title,
      description: form.description,
      date: form.date,
      expected_response_date: form.expected_response_date,
      actual_return_date: form.actual_return_date,
    };
    try {
      const res = editingRfi
        ? await updateRfi.mutateAsync({ id: editingRfi.id, data: payload })
        : await createRfi.mutateAsync(payload);
      toast.success(res.message || `${form.type} ${editingRfi ? "updated" : "created"}.`);
      setRfiModalOpen(false);
      setEditingRfi(null);
      refetchRfis();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save RFI.");
    }
  }

  async function confirmDeleteRfi() {
    try {
      const res = await deleteRfi.mutateAsync({ id: deleteTargetRfi.id });
      toast.success(res.message || `"${deleteTargetRfi.title}" deleted.`);
      setDeleteTargetRfi(null);
      refetchRfis();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to delete RFI.");
    }
  }

  async function handleSetRfiResponse(rfi, received) {
    try {
      await setRfiResponse.mutateAsync({ id: rfi.id, received });
      refetchRfis();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to update response status.");
    }
  }

  function confirmSetRfiResponse(rfi, received) {
    requestConfirm(
      received ? "Mark Response Received" : "Mark Not Received",
      `Mark "${rfi.title}" as ${received ? "response received" : "not received"}?`,
      () => handleSetRfiResponse(rfi, received)
    );
  }

  // Requires every record already completed (button is disabled otherwise —
  // see submissionCompleted below); the server re-checks this too. One-way
  // once confirmed here, unless a fresh submission is later added to the
  // project, which auto-clears it server-side (POST /api/records).
  function confirmMarkProjectCompleted() {
    requestConfirm(
      "Mark Project Completed",
      `Mark "${projectName}" as completed? Every submission in this project is already completed.`,
      async () => {
        await onMarkProjectCompleted?.();
      }
    );
  }

  // OFA/Fabrication completion is fully manual (no "every submission in
  // that group completed" gate) — clicking these just sets the signoff,
  // same as Project Completed above but without the completeness check.
  // Any not-yet-completed submissions in that group are surfaced as a
  // warning in the confirm modal (see ofaIncomplete/fabIncomplete above)
  // rather than blocking the action.
  function incompleteWarning(incomplete) {
    if (!incomplete.length) return undefined;
    const names = incomplete.map((r) => r.submission_name).join(", ");
    return `${incomplete.length} submission${incomplete.length > 1 ? "s" : ""} in this stage ${
      incomplete.length > 1 ? "aren't" : "isn't"
    } completed yet: ${names}.`;
  }

  function confirmMarkOfaCompleted() {
    requestConfirm(
      "Complete OFA",
      `Mark OFA – Issued for Approval complete for "${projectName}"?`,
      async () => {
        await onMarkOfaCompleted?.();
      },
      incompleteWarning(ofaIncomplete)
    );
  }

  function confirmMarkFabCompleted() {
    requestConfirm(
      "Complete Fabrication",
      `Mark Fabrication complete for "${projectName}"?`,
      async () => {
        await onMarkFabCompleted?.();
      },
      incompleteWarning(fabIncomplete)
    );
  }

  // `typeStage` is whichever of the two middle stages the project is
  // furthest along in — Fabrication once it's been reached, else OFA — so
  // the Type/Type Date fields below always track the project's most
  // advanced submission, even after the project completes. Each individual
  // submission's own type-complete flag (set via the now-removed "Mark Stage
  // Complete" control on the "more info" popup) still feeds buildTypeStage
  // in lib/projectLifecycle.js for any submission marked complete previously.
  const typeStage = stages[2].reached ? stages[2] : stages[1];
  const submissionCompleted = stages[3].reached;

  const client = mostCommonValue(records.map((r) => r.client));
  const teams = [...new Set(records.map((r) => r.team).filter(Boolean))];
  const creators = [...new Set(records.map((r) => r.created_by).filter(Boolean))];
  const activity = buildCombinedActivity({ records, changeOrders, rfis, deletedEvents });
  const latestRemark = [...records].reverse().find((r) => r.remarks)?.remarks;

  const statusCounts = records.reduce((acc, r) => {
    acc[r.tag] = (acc[r.tag] || 0) + 1;
    return acc;
  }, {});

  const pctClass = avgPct >= 100 ? "lifecycle-pct-done" : avgPct === 0 ? "lifecycle-pct-zero" : "lifecycle-pct-mid";

  return (
    <>
      <div className="card-form lifecycle-card">
        <div className="lifecycle-head">
          <div className="dp-header-left">
            <span className="dp-icon dp-icon-indigo">
              <i className="bi bi-diagram-3-fill" />
            </span>
            <div>
              <div className="lifecycle-title">Project Lifecycle</div>
              <div className="lifecycle-subtitle">Timeline proportional to stage dates</div>
            </div>
          </div>
          <div className="lifecycle-actions">
            <button type="button" className="btn btn-sm btn-outline-warning" onClick={openCreateRfi}>
              <i className="bi bi-file-earmark-text" /> RFI / Clarification
            </button>
            <button type="button" className="btn btn-sm btn-outline-success" onClick={openCreateCO}>
              <i className="bi bi-cash-coin" /> Change Order
            </button>
            {onMarkOfaCompleted && (
              ofaCompleted ? (
                <span className="badge lifecycle-badge-done">
                  <i className="bi bi-check-lg" /> OFA COMPLETED
                </span>
              ) : (
                canEdit && (
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={confirmMarkOfaCompleted}>
                    <i className="bi bi-flag-fill" /> Complete OFA
                  </button>
                )
              )
            )}
            {onMarkFabCompleted && (
              fabCompleted ? (
                <span className="badge lifecycle-badge-done">
                  <i className="bi bi-check-lg" /> FABRICATION COMPLETED
                </span>
              ) : (
                canEdit && (
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={confirmMarkFabCompleted}>
                    <i className="bi bi-flag-fill" /> Complete Fabrication
                  </button>
                )
              )
            )}
            {onMarkProjectCompleted && (
              projectCompleted ? (
                <span className="badge lifecycle-badge-done">
                  <i className="bi bi-check-lg" /> PROJECT COMPLETED
                </span>
              ) : (
                canEdit && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!submissionCompleted}
                    title={submissionCompleted ? "Mark this project completed" : "Every submission must be completed first"}
                    onClick={confirmMarkProjectCompleted}
                  >
                    <i className="bi bi-flag-fill" /> Mark Project Completed
                  </button>
                )
              )
            )}
          </div>
        </div>

        <div className="lifecycle-track">
          <div
            className="lifecycle-track-line"
            style={{ left: `${posFor(0)}%`, width: `${posFor(stages.length - 1) - posFor(0)}%` }}
          />
          <div
            className="lifecycle-track-fill"
            style={{ left: `${posFor(0)}%`, width: `${posFor(currentIndex - 1) - posFor(0)}%` }}
          />
          {gaps.map(
            (g, i) =>
              g != null && (
                <span key={i} className="lifecycle-gap-pill" style={{ left: `${(posFor(i) + posFor(i + 1)) / 2}%` }}>
                  {g}d
                </span>
              )
          )}
          {stages.map((s, i) => {
            const positionState = i + 1 < currentIndex ? "done" : i + 1 === currentIndex ? "current" : "pending";
            // "Project Received" has no signoff of its own — position alone
            // decides it. The other three only ever render as "done" once
            // their own manual signoff is set (projectCompleted/ofaCompleted/
            // fabCompleted) — NOT merely because a later stage has since been
            // reached (e.g. a FAB submission showing up doesn't retroactively
            // finish OFA). Reached-but-not-yet-signed-off renders as "current"
            // (still open) even if a later stage is now the positional
            // currentIndex.
            const manualSignoff =
              s.key === "completed" ? projectCompleted : s.key === "ofa" ? ofaCompleted : s.key === "fabrication" ? fabCompleted : null;
            const state =
              manualSignoff === null ? positionState : positionState === "pending" ? "pending" : manualSignoff ? "done" : "current";
            return (
              <div key={s.key} className={`lifecycle-step lifecycle-step-${state}`} style={{ left: `${posFor(i)}%` }}>
                <div className="lifecycle-circle">{state === "done" ? <i className="bi bi-check-lg" /> : i + 1}</div>
                <div className="lifecycle-step-label">{s.label}</div>
                {state === "current" ? (
                  <span className="badge lifecycle-badge-active">ACTIVE</span>
                ) : state === "done" ? (
                  <span className="badge lifecycle-badge-done">DONE</span>
                ) : (
                  <span className="badge lifecycle-badge-pending">PENDING</span>
                )}
              </div>
            );
          })}
          {[
            ...dotPositions(ofaDots, posFor(0), posFor(1)),
            ...dotPositions(fabDots, posFor(1), posFor(2)),
          ].map(({ cluster, left }, i) => (
            <button
              key={i}
              type="button"
              className="lifecycle-type-dot"
              style={{ left: `${left}%` }}
              title={`${cluster.records.length} submission${cluster.records.length > 1 ? "s" : ""} — ${
                fmtDateLong(cluster.date) || "No date"
              }`}
              onClick={() => setDotPopup(cluster)}
            >
              {cluster.records.length > 1 && <span className="lifecycle-dot-count">{cluster.records.length}</span>}
            </button>
          ))}
        </div>

        <div className="lifecycle-footer">
          <span>
            Stage {currentIndex} of {stages.length} — {stages[currentIndex - 1].label}
          </span>
          <span className={`lifecycle-pct ${pctClass}`}>{avgPct}%</span>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <div className="detail-panel">
            <PanelHeader
              icon="bi-list-check"
              color="blue"
              title="Submission Details"
              subtitle="Every submission in this project"
              count={records.length}
            />
            <div className="filter-bar d-flex flex-wrap gap-2">
              <select className="form-select" style={{ maxWidth: 180 }} value={subTypeFilter} onChange={(e) => setSubTypeFilter(e.target.value)}>
                <option value="">All types</option>
                {submissionTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select className="form-select" style={{ maxWidth: 180 }} value={subCompletedFilter} onChange={(e) => setSubCompletedFilter(e.target.value)}>
                <option value="">Completed &amp; not completed</option>
                <option value="Completed">Completed</option>
                <option value="Not Completed">Not Completed</option>
              </select>
            </div>
            <div className="detail-panel-body">
              {filteredSubmissions.length ? (
                <div className="submission-row-list">
                  {filteredSubmissions.map((r) => (
                    <div key={r.id} className="submission-row">
                      <div className="submission-row-main">
                        <span className="submission-row-name">{r.submission_name}</span>
                        <span className="submission-row-type">{r.submission_type}</span>
                      </div>
                      <div className="submission-row-right">
                        <span className="submission-row-date">{fmtDateLong(r.sub_date_raw) || "Not set"}</span>
                        <StatusBadge status={r.status} tag={r.tag} />
                        <span className="submission-row-pct">{r.percentage ?? 0}%</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          title="View details"
                          onClick={() =>
                            setDotPopup({ date: parseDate(r.sub_date_raw) || parseDate(r.created_at_raw), records: [r] })
                          }
                        >
                          <i className="bi bi-info-circle" />
                        </button>
                        {canEdit && onEditRecord && (
                          <button type="button" className="btn btn-sm btn-outline-primary" title="Edit" onClick={() => onEditRecord(r)}>
                            <i className="bi bi-pencil" />
                          </button>
                        )}
                        {canDelete && onDeleteRecord && (
                          <button type="button" className="btn btn-sm btn-outline-danger" title="Delete" onClick={() => onDeleteRecord(r)}>
                            <i className="bi bi-trash" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <i className="bi bi-funnel" />
                  <div>No matching submissions</div>
                  <div className="text-muted small">Try a different filter</div>
                </div>
              )}
            </div>
          </div>

          <div className="co-rfi-row">
            <div className="detail-panel" id="change-order-section">
              <PanelHeader
                icon="bi-cash-coin"
                color="green"
                title="Change Orders"
                subtitle="Approved and pending changes to scope, cost, or schedule"
                count={changeOrders.length}
                actions={
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={exportChangeOrdersCSV}
                      disabled={!changeOrders.length}
                    >
                      <i className="bi bi-download" /> Export
                    </button>
                    <button type="button" className="btn btn-sm btn-success" onClick={openCreateCO}>
                      <i className="bi bi-plus-lg" /> Add CO
                    </button>
                  </>
                }
              />
              {changeOrders.length > 0 && (
                <div className="rfi-filter-bar">
                  <span className="rfi-filter-label">Filter:</span>
                  {["All", "Pending", "Approved", "Rejected", "Billed"].map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`rfi-filter-pill${coFilter === f ? " active" : ""}`}
                      onClick={() => setCoFilter(f)}
                    >
                      {f === "Pending" && <i className="bi bi-hourglass-split" />}
                      {f === "Approved" && <i className="bi bi-check-lg" />}
                      {f === "Rejected" && <i className="bi bi-x-lg" />}
                      {f === "Billed" && <i className="bi bi-cash-coin" />}
                      {f}
                    </button>
                  ))}
                </div>
              )}
              <div className="detail-panel-body">
                {filteredChangeOrders.length ? (
                  <div className="co-list">
                    {filteredChangeOrders.map((co) => (
                      <ChangeOrderCard
                        key={co.id}
                        co={co}
                        canEdit={canEdit}
                        canDelete={canDeleteChangeOrders}
                        onEdit={openEditCO}
                        onDelete={setDeleteTargetCO}
                        onSetApproval={confirmSetApproval}
                        onToggleBilled={confirmToggleBilled}
                      />
                    ))}
                  </div>
                ) : changeOrders.length ? (
                  <div className="empty-state">
                    <i className="bi bi-funnel" />
                    <div>No {coFilter.toLowerCase()} change orders</div>
                    <div className="text-muted small">Try a different filter</div>
                  </div>
                ) : (
                  <div className="empty-state">
                    <i className="bi bi-cash-stack" />
                    <div>No change orders yet</div>
                    <div className="text-muted small">Click "+ Add CO" to create one</div>
                  </div>
                )}
              </div>
            </div>

            <div className="detail-panel" id="rfi-section">
              <PanelHeader
                icon="bi-file-earmark-text-fill"
                color="amber"
                title="RFI / Clarification"
                subtitle="Questions and clarifications for this project"
                count={rfis.length}
                actions={
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={exportRfisCSV}
                      disabled={!rfis.length}
                    >
                      <i className="bi bi-download" /> Export
                    </button>
                    <button type="button" className="btn btn-sm btn-warning" onClick={openCreateRfi}>
                      <i className="bi bi-plus-lg" /> Add
                    </button>
                  </>
                }
              />
              {rfis.length > 0 && (
                <div className="rfi-filter-bar">
                  <span className="rfi-filter-label">Filter:</span>
                  {["All", "Pending", "Overdue", "Returned"].map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`rfi-filter-pill${rfiFilter === f ? " active" : ""}`}
                      onClick={() => setRfiFilter(f)}
                    >
                      {f === "Pending" && <i className="bi bi-hourglass-split" />}
                      {f === "Overdue" && <i className="bi bi-exclamation-triangle-fill" />}
                      {f === "Returned" && <i className="bi bi-check-lg" />}
                      {f}
                    </button>
                  ))}
                </div>
              )}
              <div className="detail-panel-body">
                {filteredRfis.length ? (
                  <div className="co-list">
                    {filteredRfis.map((rfi) => (
                      <RfiCard
                        key={rfi.id}
                        rfi={rfi}
                        canEdit={canEdit}
                        canDelete={canDeleteRfis}
                        onEdit={openEditRfi}
                        onDelete={setDeleteTargetRfi}
                        onSetResponseReceived={confirmSetRfiResponse}
                      />
                    ))}
                  </div>
                ) : rfis.length ? (
                  <div className="empty-state">
                    <i className="bi bi-funnel" />
                    <div>No {rfiFilter.toLowerCase()} RFIs</div>
                    <div className="text-muted small">Try a different filter</div>
                  </div>
                ) : (
                  <div className="empty-state">
                    <i className="bi bi-clipboard" />
                    <div>No RFIs yet</div>
                    <div className="text-muted small">Click "+ Add" to create one</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="detail-side">
          <ProjectImagePanel
            projectName={projectName}
            imageFilename={projectImageFilename}
            canEdit={canEdit}
            onChanged={onProjectImageChanged}
          />

          <div className="detail-panel">
            <PanelHeader
              icon="bi-info-circle-fill"
              color="blue"
              title="Project Details"
              subtitle="Key info about this project"
            />
            <div className="detail-panel-body">
              <div className="dp-fields-grid">
                <div className="dp-field">
                  <div className="dp-field-label">Client</div>
                  <div className="dp-field-value">{client || "—"}</div>
                </div>
                <div className="dp-field">
                  <div className="dp-field-label">Team</div>
                  <div className="dp-field-value">{teams.join(", ") || "Unassigned"}</div>
                </div>
                <div className="dp-field">
                  <div className="dp-field-label">Start Date</div>
                  <div className="dp-field-value">{fmtDateLong(stages[0].date) || "Not set"}</div>
                </div>
                <div className="dp-field">
                  <div className="dp-field-label">{typeStage.submissionType ? `${typeStage.submissionType} Date` : "Type Date"}</div>
                  <div className="dp-field-value">{fmtDateLong(typeStage.date) || "Not set"}</div>
                </div>
                <div className="dp-field">
                  <div className="dp-field-label">Type</div>
                  <div className="dp-field-value">{typeStage.submissionType || "—"}</div>
                </div>
                <div className="dp-field">
                  <div className="dp-field-label">Created By</div>
                  <div className="dp-field-value">{creators.join(", ") || "—"}</div>
                </div>
                <div className="dp-field">
                  <div className="dp-field-label">OFA Completed</div>
                  <div className="dp-field-value">{ofaCompleted ? fmtDateTimeLong(ofaCompletedAt) || "Yes" : "Not yet"}</div>
                </div>
                <div className="dp-field">
                  <div className="dp-field-label">Fabrication Completed</div>
                  <div className="dp-field-value">{fabCompleted ? fmtDateTimeLong(fabCompletedAt) || "Yes" : "Not yet"}</div>
                </div>
                <div className="dp-field">
                  <div className="dp-field-label">Project Completed</div>
                  <div className="dp-field-value">
                    {projectCompleted ? fmtDateTimeLong(projectCompletedAt) || "Yes" : "Not yet"}
                  </div>
                </div>
              </div>
              {latestRemark && <div className="dp-note">"{latestRemark}"</div>}
              <div className="dp-tags">
                {Object.entries(statusCounts).map(([tag, count]) => (
                  <span key={tag} className={`badge badge-${tag}`}>
                    {count} {tag.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="detail-panel">
            <PanelHeader
              icon="bi-clock-history"
              color="teal"
              title="Activity"
              subtitle="Recent updates and changes"
            />
            <div className="detail-panel-body">
              {activity.length ? (
                activity.map((ev, i) => (
                  <div key={i} className="activity-item">
                    <span className="activity-dot" />
                    <div>
                      <div className="activity-title">{ev.title}</div>
                      <div className="activity-meta">
                        {ev.user} · {ev.dateStr}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-muted small">No activity yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={!!pendingAction}
        onClose={() => setPendingAction(null)}
        title={pendingAction?.title || "Confirm"}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setPendingAction(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={confirmPendingAction}>Confirm</button>
          </>
        }
      >
        <p className={pendingAction?.warning ? "" : "mb-0"}>{pendingAction?.message}</p>
        {pendingAction?.warning && <p className="mb-0 confirm-warning">⚠ {pendingAction.warning}</p>}
      </Modal>

      <Modal
        open={!!dotPopup}
        onClose={() => setDotPopup(null)}
        title={
          dotPopup
            ? `${fmtDateLong(dotPopup.date) || "No date"} — ${dotPopup.records.length} submission${
                dotPopup.records.length > 1 ? "s" : ""
              }`
            : ""
        }
      >
        {dotPopup?.records.map((r, i) => (
          <div key={r.id} className={i > 0 ? "dot-popup-record dot-popup-record-sep" : "dot-popup-record"}>
            <div className="dot-popup-title">
              <span className="dot-popup-type">{r.submission_type}</span> {r.submission_name}
            </div>
            <div className="dp-fields-grid">
              <div className="dp-field">
                <div className="dp-field-label">Submission #</div>
                <div className="dp-field-value">#{r.id}</div>
              </div>
              <div className="dp-field">
                <div className="dp-field-label">Sub Date</div>
                <div className="dp-field-value">{fmtDateLong(r.sub_date_raw) || "Not set"}</div>
              </div>
              <div className="dp-field">
                <div className="dp-field-label">Due Date</div>
                <div className="dp-field-value">{fmtDateLong(r.due_date_raw) || "Not set"}</div>
              </div>
              <div className="dp-field">
                <div className="dp-field-label">Team</div>
                <div className="dp-field-value">{r.team || "—"}</div>
              </div>
              <div className="dp-field">
                <div className="dp-field-label">Created By</div>
                <div className="dp-field-value">{r.created_by || "—"}</div>
              </div>
              <div className="dp-field">
                <div className="dp-field-label">Percentage</div>
                <div className="dp-field-value">{r.percentage ?? 0}%</div>
              </div>
            </div>
            <div className="dot-popup-status">
              <StatusBadge status={r.status} tag={r.tag} />
            </div>
            {r.remarks && <div className="dp-note">"{r.remarks}"</div>}
          </div>
        ))}
      </Modal>

      <CreateChangeOrderModal
        open={coModalOpen}
        onClose={() => {
          setCoModalOpen(false);
          setEditingCO(null);
        }}
        onSubmit={submitChangeOrder}
        submitting={editingCO ? updateCO.isPending : createCO.isPending}
        initial={editingCO}
        teamOptions={coDashboardConfig?.selectableTeams || []}
        defaultTeam={coDashboardConfig?.defaultTeam || ""}
      />

      {deleteTargetCO && (
        <div className="st-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDeleteTargetCO(null)}>
          <div className="st-modal" style={{ maxWidth: 420 }}>
            <div className="st-modal-header header-danger">
              <h5 className="m-0">Delete Change Order</h5>
            </div>
            <div className="st-modal-body">
              <p className="m-0">
                Delete Change Order <strong>#{deleteTargetCO.co_number}</strong> ({deleteTargetCO.change_type})?
              </p>
            </div>
            <div className="st-modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteTargetCO(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDeleteCO} disabled={deleteCO.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <CreateRfiModal
        open={rfiModalOpen}
        onClose={() => {
          setRfiModalOpen(false);
          setEditingRfi(null);
        }}
        onSubmit={submitRfi}
        submitting={editingRfi ? updateRfi.isPending : createRfi.isPending}
        initial={editingRfi}
      />

      {deleteTargetRfi && (
        <div className="st-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDeleteTargetRfi(null)}>
          <div className="st-modal" style={{ maxWidth: 420 }}>
            <div className="st-modal-header header-danger">
              <h5 className="m-0">Delete RFI / Clarification</h5>
            </div>
            <div className="st-modal-body">
              <p className="m-0">
                Delete <strong>{deleteTargetRfi.type}</strong> "{deleteTargetRfi.title}"?
              </p>
            </div>
            <div className="st-modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteTargetRfi(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDeleteRfi} disabled={deleteRfi.isPending}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
