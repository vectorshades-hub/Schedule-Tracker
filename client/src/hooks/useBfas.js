"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useBfas(project) {
  return useQuery({
    queryKey: ["bfas", project],
    queryFn: () => api.get("/bfas", { project }),
    enabled: !!project,
  });
}

export function useCreateBfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post("/bfas", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bfas"] }),
  });
}

export function useUpdateBfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.put(`/bfas/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bfas"] }),
  });
}

export function useDeleteBfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.delete(`/bfas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bfas"] }),
  });
}
