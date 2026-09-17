"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useFinanceDashboardChangeOrders(params) {
  return useQuery({
    queryKey: ["finance-dashboard", "change-orders", params],
    queryFn: () => api.get("/finance-dashboard/change-orders", params),
    keepPreviousData: true,
  });
}

export function useAcknowledgeFinance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, acknowledged = true }) => api.post(`/change-orders/${id}/finance-acknowledge`, { acknowledged }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-dashboard"] });
      qc.invalidateQueries({ queryKey: ["management-dashboard"] });
      qc.invalidateQueries({ queryKey: ["change-orders"] });
    },
  });
}
