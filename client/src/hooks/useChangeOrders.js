"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useChangeOrders(project) {
  return useQuery({
    queryKey: ["change-orders", project],
    queryFn: () => api.get("/change-orders", { project }),
    enabled: !!project,
  });
}

export function useCreateChangeOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post("/change-orders", data),
    onSuccess: (_res, vars) => qc.invalidateQueries({ queryKey: ["change-orders", vars.project] }),
  });
}

export function useUpdateChangeOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.put(`/change-orders/${id}`, data),
    // The project a CO belongs to can change project across an edit (in
    // theory), so invalidate the whole change-orders cache rather than just
    // the one project key — a partial queryKey match covers every project.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["change-orders"] }),
  });
}

export function useDeleteChangeOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.delete(`/change-orders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["change-orders"] }),
  });
}

export function useSetChangeOrderApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approval }) => api.post(`/change-orders/${id}/approval`, { approval }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["change-orders"] }),
  });
}

export function useToggleChangeOrderBilled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, billed }) => api.post(`/change-orders/${id}/billed`, { billed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["change-orders"] }),
  });
}
