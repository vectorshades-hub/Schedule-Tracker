"use client";

/** A clickable table header for server-sorted tables (see managementDashboard.js
 * / financeDashboard.js's `sort_by`/`sort_dir` query params). Clicking a column
 * that isn't the active sort switches to it ascending; clicking the active
 * column again flips its direction. `field` is whatever key the backend's
 * sort accepts for this column — pass null/undefined for non-sortable columns
 * (e.g. a trailing actions column) to render a plain <th>. */
export default function SortableTh({ field, sortBy, sortDir, onSort, children, className = "" }) {
  if (!field) return <th className={className}>{children}</th>;

  const active = sortBy === field;
  return (
    <th className={`${active ? "sort-active" : ""} ${className}`.trim()} onClick={() => onSort(field)}>
      {children}
      <i className={`bi ${active ? (sortDir === "desc" ? "bi-caret-down-fill" : "bi-caret-up-fill") : "bi-arrow-down-up"} sort-icon`} />
    </th>
  );
}
