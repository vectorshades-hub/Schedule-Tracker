"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useRecordsQuery(params) {
  return useQuery({
    queryKey: ["records", params],
    queryFn: () => api.get("/records", params),
    enabled: params !== null,
    keepPreviousData: true,
  });
}

export function useDashboardConfig(params) {
  return useQuery({
    queryKey: ["dashboard-config", params],
    queryFn: () => api.get("/records/dashboard-config", params),
  });
}

/** A single submission, for the submission detail page. */
export function useRecordQuery(id) {
  return useQuery({
    queryKey: ["record", id],
    queryFn: () => api.get(`/records/${id}`),
    enabled: !!id,
  });
}

export function useAddRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData) => api.post("/records", formData),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["records"] }),
  });
}

export function useUpdateRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, formData }) => api.put(`/records/${id}`, formData),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["records"] }),
  });
}

export function useDeleteRecord() {
  const qc = useQueryClient();
  return useMutation({
    // No password anymore — the server checks the caller against Settings'
    // "who can delete records" list (settingsService.canDeleteRecords).
    mutationFn: ({ id }) => api.delete(`/records/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["records"] }),
  });
}

export function useToggleField() {
  const qc = useQueryClient();
  return useMutation({
    // Plain JSON, not FormData — these routes have no multipart parser (no file involved).
    mutationFn: ({ id, field, value }) => api.post(`/records/${id}/toggle-field`, { field, value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["records"] }),
  });
}

export function useQaqcToggle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }) => api.post(`/records/${id}/qaqc`, { qaqc_value: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["records"] }),
  });
}

/** Marks the Project Lifecycle widget's current stage done — separate from
 * (and does not affect) the record's own status/completedAt. */
export function useTypeComplete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post(`/records/${id}/type-complete`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["records"] }),
  });
}

