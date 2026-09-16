"use client";
import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { api } from "../lib/api";
import { API_URL } from "../lib/api";
import { useToast } from "../lib/ToastContext";

/**
 * Covers all 3 entry flows from the original (Add w/ ON HOLD, Edit w/ ON HOLD, standalone
 * paperclip on an existing hold row): `mode` is "add" | "edit" | "standalone". In "add"/"edit"
 * mode, saving just calls `onAttach(note, file)` so the parent form can carry the file into its
 * own add/update submit (matching the original's "defer submit until modal closes" behavior).
 * In "standalone" mode, saving calls the `/hold/save` API directly.
 */
export default function HoldAttachmentModal({ open, onClose, mode, recordId, initial, onAttach, onSaved }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [existingImage, setExistingImage] = useState("");
  const [removeExisting, setRemoveExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const dropRef = useRef(null);

  useEffect(() => {
    if (open) {
      setNote(initial?.text || "");
      setExistingImage(initial?.image_filename || "");
      setFile(null);
      setPreview("");
      setRemoveExisting(false);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    function onPaste(e) {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (item) handleFile(item.getAsFile());
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleFile(f) {
    if (!f) return;
    setFile(f);
    setRemoveExisting(false);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(f);
  }

  async function handleSave() {
    if (mode !== "standalone") {
      onAttach?.(note, file);
      onClose();
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("record_id", recordId);
      fd.append("hold_text", note);
      if (removeExisting) fd.append("remove_image", "1");
      if (file) fd.append("hold_image", file);
      const data = await api.post("/hold/save", fd);
      if (data.ok) {
        onSaved?.();
        onClose();
        toast.success("Hold attachment saved.");
      } else {
        toast.error(data.error || "Failed to save.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Hold Attachment"
      theme="purple"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : "Save & Continue"}
          </button>
        </>
      }
    >
      <div
        ref={dropRef}
        className="border border-2 border-dashed rounded p-4 text-center mb-3"
        style={{ cursor: "pointer" }}
        onClick={() => document.getElementById("holdFileInput")?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        {preview ? (
          <img src={preview} alt="preview" style={{ maxWidth: "100%", maxHeight: 220 }} />
        ) : existingImage && !removeExisting ? (
          <div>
            <img src={`${API_URL}/hold/image/${existingImage}`} alt="current" style={{ maxWidth: "100%", maxHeight: 220 }} />
            <div className="mt-2">
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  setRemoveExisting(true);
                }}
              >
                Remove image
              </button>
            </div>
          </div>
        ) : (
          <div className="text-muted">
            <i className="bi bi-cloud-arrow-up fs-2" />
            <div>Drag & drop, paste (Ctrl+V), or click to choose an image</div>
          </div>
        )}
        <input
          id="holdFileInput"
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
      <label className="form-label">Note</label>
      <textarea className="form-control" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}
