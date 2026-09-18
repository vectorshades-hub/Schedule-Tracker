"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useManagementDashboardChangeOrders(params) {
  return useQuery({
    queryKey: ["management-dashboard", "change-orders", params],
    queryFn: () => api.get("/management-dashboard/change-orders", params),
    keepPreviousData: true,
  });
}

export function useSetInvoiceReleased() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, invoiceReleased, reason }) =>
      api.post(`/change-orders/${id}/invoice-released`, { invoice_released: invoiceReleased, reason }),
    // Setting Invoice Released to "Yes" can auto-release the CO to Finance
    // (see routes/changeOrders.js), so the Finance Dashboard's own query
    // needs invalidating too, not just this dashboard's.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["management-dashboard"] });
      qc.invalidateQueries({ queryKey: ["finance-dashboard"] });
      qc.invalidateQueries({ queryKey: ["change-orders"] });
    },
  });
}

export function useReleaseToFinance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, released = true }) => api.post(`/change-orders/${id}/release-to-finance`, { released }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["management-dashboard"] });
      qc.invalidateQueries({ queryKey: ["finance-dashboard"] });
      qc.invalidateQueries({ queryKey: ["change-orders"] });
    },
  });
}
