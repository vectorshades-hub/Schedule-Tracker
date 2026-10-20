"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppLayout from "../../components/AppLayout";

/**
 * Shown when a user opens a project from Manage Projects & Clients that
 * they're neither the Team nor the Created By on (see `accessible` in
 * GET /api/projects).
 */
function NoAccessBody() {
  const project = useSearchParams().get("project");
  return (
    <div className="empty-state" style={{ marginTop: 48 }}>
      <i className="bi bi-shield-lock-fill" />
      <h4 className="mt-2">No Access</h4>
      <div className="text-muted">
        You don&apos;t have access to {project ? <strong>&quot;{project}&quot;</strong> : "this project"} — only its team or creator can open it.
      </div>
      <a href="/projects" className="back-link mt-3 d-inline-flex">
        <i className="bi bi-arrow-left" /> Back to Manage Projects &amp; Clients
      </a>
    </div>
  );
}

export default function NoAccessPage() {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <NoAccessBody />
      </Suspense>
    </AppLayout>
  );
}
