"use client";

/** Read-only completion % badge for the records tables — editing happens in the Edit Record panel (admin/management only), not inline here. */
export default function PercentageCell({ value }) {
  return <span className="percentage-badge">{value ?? 0}%</span>;
}
