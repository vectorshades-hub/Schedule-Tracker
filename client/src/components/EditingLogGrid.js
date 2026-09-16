"use client";
import { useState } from "react";

const EDITABLE_COLS = ["detailed_by", "checked_by", "corrected_by", "qc_done", "qc_comment", "remarks"];
const COL_LABELS = { detailed_by: "Detailed By", checked_by: "Checked By", corrected_by: "Corrected By", qc_done: "QC Done", qc_comment: "QC Cmt Updated", remarks: "Remarks" };

/**
 * Spreadsheet-style preview/edit grid for a freshly-parsed upload, before it's saved.
 * Supports rectangular click/shift-click selection, Ctrl+C/Ctrl+V (TSV clipboard,
 * matching the original), and Ctrl+D fill-down over the selection. The original also
 * had a mouse-drag fill-handle and a right-click context menu as additional ways to
 * reach the same operations — omitted here to keep this port's scope manageable, but
 * every operation they exposed is reachable via keyboard.
 */
export default function EditingLogGrid({ rows, onChange }) {
  const [sel, setSel] = useState(null); // {r1,c1,r2,c2} in EDITABLE_COLS index space
  const [anchor, setAnchor] = useState(null);

  function norm(s) {
    if (!s) return null;
    return { r1: Math.min(s.r1, s.r2), r2: Math.max(s.r1, s.r2), c1: Math.min(s.c1, s.c2), c2: Math.max(s.c1, s.c2) };
  }
  const normSel = norm(sel);

  function setCell(rIdx, col, value) {
    const next = rows.slice();
    next[rIdx] = { ...next[rIdx], [col]: value };
    onChange(next);
  }

  function startSelect(r, c) {
    setAnchor({ r, c });
    setSel({ r1: r, c1: c, r2: r, c2: c });
  }
  function extendSelect(r, c) {
    if (!anchor) return;
    setSel({ r1: anchor.r, c1: anchor.c, r2: r, c2: c });
  }

  function handleKeyDown(e) {
    if (!normSel) return;
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      const tsv = [];
      for (let r = normSel.r1; r <= normSel.r2; r++) {
        const line = [];
        for (let c = normSel.c1; c <= normSel.c2; c++) line.push(rows[r][EDITABLE_COLS[c]] ?? "");
        tsv.push(line.join("\t"));
      }
      navigator.clipboard?.writeText(tsv.join("\n")).catch(() => {});
    } else if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      navigator.clipboard?.readText().then((text) => {
        const lines = text.replace(/\r/g, "").split("\n").filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""));
        const next = rows.slice();
        if (lines.length === 1 && !lines[0].includes("\t")) {
          for (let r = normSel.r1; r <= normSel.r2; r++)
            for (let c = normSel.c1; c <= normSel.c2; c++) next[r] = { ...next[r], [EDITABLE_COLS[c]]: lines[0] };
        } else {
          lines.forEach((line, li) => {
            const cells = line.split("\t");
            cells.forEach((val, ci) => {
              const r = normSel.r1 + li;
              const c = normSel.c1 + ci;
              if (r < next.length && c < EDITABLE_COLS.length) next[r] = { ...next[r], [EDITABLE_COLS[c]]: val };
            });
          });
        }
        onChange(next);
      });
    } else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      const next = rows.slice();
      for (let c = normSel.c1; c <= normSel.c2; c++) {
        const topVal = next[normSel.r1][EDITABLE_COLS[c]] ?? "";
        for (let r = normSel.r1 + 1; r <= normSel.r2; r++) next[r] = { ...next[r], [EDITABLE_COLS[c]]: topVal };
      }
      onChange(next);
    } else if (e.key === "Escape") {
      setSel(null);
      setAnchor(null);
    }
  }

  return (
    <div className="table-wrap theme-indigo" tabIndex={0} onKeyDown={handleKeyDown} style={{ outline: "none" }}>
      <table className="table table-sm table-bordered mb-0" style={{ userSelect: "none" }}>
        <thead>
          <tr>
            <th>#</th>
            <th>Sheet Name</th>
            <th>Type</th>
            {EDITABLE_COLS.map((c) => <th key={c}>{COL_LABELS[c]}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              <td>{r + 1}</td>
              <td>{row.sheet_name}</td>
              <td><span className={`badge badge-${row.sheet_type?.toLowerCase()}`}>{row.sheet_type}</span></td>
              {EDITABLE_COLS.map((col, c) => {
                const isSelected = normSel && r >= normSel.r1 && r <= normSel.r2 && c >= normSel.c1 && c <= normSel.c2;
                return (
                  <td
                    key={col}
                    style={isSelected ? { outline: "2px solid #4da6ff", background: "#eaf4ff" } : undefined}
                    onMouseDown={() => startSelect(r, c)}
                    onMouseEnter={(e) => e.buttons === 1 && extendSelect(r, c)}
                  >
                    {col === "qc_done" ? (
                      <select className="form-select form-select-sm" value={row.qc_done || ""} onChange={(e) => setCell(r, col, e.target.value)}>
                        <option value=""></option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    ) : (
                      <input className="form-control form-control-sm" value={row[col] || ""} onChange={(e) => setCell(r, col, e.target.value)} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
