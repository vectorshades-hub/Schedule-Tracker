/**
 * A Change Order's displayed status tracks its finance handoff (see
 * server/src/models/ChangeOrder.js's releasedToFinance/financeAcknowledged),
 * not the internal `approval` flag — that field stays editable but isn't
 * shown as a separate status. Shared by ChangeOrderCard (the status pill)
 * and SubmissionOverview (the Change Orders filter bar) so both stay in sync.
 */
export const CHANGE_ORDER_STATUSES = [
  { key: "pending", label: "Pending", icon: "bi-hourglass-split" },
  { key: "sent", label: "Sent to Finance", icon: "bi-send-check" },
  { key: "finance", label: "Finance Approved", icon: "bi-bank" },
];

export function getChangeOrderStatus(co) {
  if (co.finance_acknowledged) return CHANGE_ORDER_STATUSES.find((s) => s.key === "finance");
  if (co.released_to_finance) return CHANGE_ORDER_STATUSES.find((s) => s.key === "sent");
  return CHANGE_ORDER_STATUSES.find((s) => s.key === "pending");
}
