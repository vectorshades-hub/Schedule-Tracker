"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useRfis(project) {
  return useQuery({
    queryKey: ["rfis", project],
    queryFn: () => api.get("/rfis", { project }),
    enabled: !!project,
  });
}

export function useCreateRfi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post("/rfis", data),
    onSuccess: (_res, vars) => qc.invalidateQueries({ queryKey: ["rfis", vars.project] }),
  });
}

export function useUpdateRfi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.put(`/rfis/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rfis"] }),
  });
}

export function useDeleteRfi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.delete(`/rfis/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rfis"] }),
  });
}

/** "Response Received" toggle — reversible (see rfis.js's POST /:id/response). */
export function useSetRfiResponseReceived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, received }) => api.post(`/rfis/${id}/response`, { received }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rfis"] }),
  });
}
