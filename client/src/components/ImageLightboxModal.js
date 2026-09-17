"use client";
import { useEffect, useState } from "react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

/** Full-screen image viewer (project cover image, etc.) with zoom in/out and an "open in new tab" escape hatch. */
export default function ImageLightboxModal({ open, onClose, src, title = "Image" }) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (open) setZoom(1);
  }, [open, src]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !src) return null;

  return (
    <div className="image-lightbox-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="image-lightbox-toolbar">
        <span className="image-lightbox-title">{title}</span>
        <div className="image-lightbox-tools">
          <button type="button" className="btn btn-sm btn-light" title="Zoom out" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))}>
            <i className="bi bi-dash-lg" />
          </button>
          <span className="image-lightbox-zoom-pct">{Math.round(zoom * 100)}%</span>
          <button type="button" className="btn btn-sm btn-light" title="Zoom in" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))}>
            <i className="bi bi-plus-lg" />
          </button>
          <button type="button" className="btn btn-sm btn-light" title="Reset zoom" onClick={() => setZoom(1)}>
            <i className="bi bi-aspect-ratio" />
          </button>
          <a className="btn btn-sm btn-light" href={src} target="_blank" rel="noreferrer" title="Open in new tab">
            <i className="bi bi-box-arrow-up-right" />
          </a>
          <button type="button" className="btn btn-sm btn-light" title="Close" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
      </div>
      <div className="image-lightbox-body">
        <img src={src} alt={title} style={{ transform: `scale(${zoom})` }} />
      </div>
    </div>
  );
}
