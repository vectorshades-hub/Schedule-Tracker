"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "../components/AppLayout";
import RecordsDashboard from "../components/RecordsDashboard";
import { useAuth } from "../lib/AuthContext";

/**
 * The single records dashboard for every role — used to be split across this
 * page (admin-only) and /management (everyone else), each rendering the same
 * RecordsDashboard with a `variant` prop that just mirrored the route. Merged
 * here since RecordsDashboard now branches entirely on `user.role` itself.
 *
 * `finance` isn't in RecordsDashboard's allow list (it has its own dashboard
 * at /finance-dashboard, not a records view) — redirected here rather than
 * added to AppLayout's `allow`, which would otherwise bounce it right back to
 * this same route.
 */
export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user?.role === "finance") router.replace("/finance-dashboard");
  }, [loading, user, router]);

  if (user?.role === "finance") return null;

  return (
    <AppLayout allow={["admin", "management", "team_lead", "qaqc", "user"]}>
      <RecordsDashboard />
    </AppLayout>
  );
}
