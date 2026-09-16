"use client";
import Modal from "./Modal";

export default function RecordInfoModal({ open, onClose, record }) {
  if (!record) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Record #${record.id}`} theme="gradientBlue">
      <dl className="row mb-0">
        <dt className="col-5">Created By</dt>
        <dd className="col-7">{record.created_by}</dd>
        <dt className="col-5">Created At</dt>
        <dd className="col-7">{record.created_at}</dd>
        <dt className="col-5">Completed At</dt>
        <dd className="col-7">{record.completed_at ? new Date(record.completed_at).toLocaleString() : "—"}</dd>
      </dl>
    </Modal>
  );
}
