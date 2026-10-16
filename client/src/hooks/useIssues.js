"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_URL } from "../lib/api";

export function useIssues() {
  return useQuery({
    queryKey: ["issues"],
    queryFn: () => api.get("/issues"),
  });
}

/** Create (no `id`) or update an issue — `formData` carries the fields plus any
 * new `issue_files` / `response_files` (see issues.js's POST / and PUT /:id). */
export function useSaveIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, formData }) => (id ? api.put(`/issues/${id}`, formData) : api.post("/issues", formData)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues"] }),
  });
}

export function useDeleteIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.delete(`/issues/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues"] }),
  });
}

export function useDeleteIssueAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, attachmentId }) => api.delete(`/issues/${id}/attachments/${attachmentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues"] }),
  });
}

export const issueAttachmentUrl = (issueId, attachmentId) => `${API_URL}/issues/${issueId}/attachments/${attachmentId}/file`;
