"use client";
import { useState } from "react";
import Modal from "./Modal";
import { API_URL } from "../lib/api";

export default function HoldViewModal({ open, onClose, record }) {
  const [zoom, setZoom] = useState(1);

  if (!record) return null;
  const imgUrl = record.hold_image ? `${API_URL}/hold/image/${record.hold_image}` : null;

  return (
    <Modal open={open} onClose={() => { setZoom(1); onClose(); }} title="Hold Note" maxWidth={640} theme="purple">
      {record.hold_text && <p className="mb-3">{record.hold_text}</p>}
      {imgUrl && (
        <div className="text-center">
          <div style={{ overflow: "auto", maxHeight: 420, border: "1px solid #eee", borderRadius: 6 }}>
            <img src={imgUrl} alt="hold attachment" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }} />
          </div>
          <div className="d-flex align-items-center justify-content-center gap-2 mt-2">
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
              <i className="bi bi-zoom-out" />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
              <i className="bi bi-zoom-in" />
            </button>
            <a href={imgUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-primary ms-2">
              Full size
            </a>
          </div>
        </div>
      )}
      <div className="text-muted small mt-3">
        {record.hold_user} · {record.hold_ts ? new Date(record.hold_ts).toLocaleString() : ""}
      </div>
    </Modal>
  );
}
