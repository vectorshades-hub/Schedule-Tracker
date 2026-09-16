"use client";
import AppLayout from "../components/AppLayout";
import RecordsDashboard from "../components/RecordsDashboard";

/**
 * The single records dashboard for every role — used to be split across this
 * page (admin-only) and /management (everyone else), each rendering the same
 * RecordsDashboard with a `variant` prop that just mirrored the route. Merged
 * here since RecordsDashboard now branches entirely on `user.role` itself.
 */
export default function DashboardPage() {
  return (
    <AppLayout allow={["admin", "management", "team_lead", "qaqc", "user"]}>
      <RecordsDashboard />
    </AppLayout>
  );
}
