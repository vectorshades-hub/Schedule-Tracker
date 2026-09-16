"use client";

export default function StatusBadge({ status, tag }) {
  return <span className={`badge badge-${tag}`}>{status}</span>;
}
