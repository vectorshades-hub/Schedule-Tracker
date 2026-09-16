"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/** "Deleted" Change Order/RFI events for a project — see
 * server/src/routes/activityLog.js's GET /project. Everything else in the
 * Activity panel (created/updated/completed/etc.) is derived directly from
 * the records/change-orders/rfis already loaded, not from this endpoint. */
export function useProjectActivity(project) {
  return useQuery({
    queryKey: ["activity-log", "project", project],
    queryFn: () => api.get("/activity-log/project", { project }),
    enabled: !!project,
  });
}
