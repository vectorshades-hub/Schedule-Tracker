"use client";
import { useAuth } from "../lib/AuthContext";
import { useRecordQuery } from "../hooks/useRecords";
import PageHero from "./PageHero";
import SubmissionOverview from "./SubmissionOverview";

/** One submission's own detail page — the Project Lifecycle widget scoped to
 * just this record (see SubmissionOverview.js), reached by clicking a
 * submission's name anywhere in the app. */
export default function SubmissionDetail({ id }) {
  const { user } = useAuth();
  const canEdit = ["admin", "management"].includes(user.role);
  const { data, isLoading, isError, refetch } = useRecordQuery(id);
  const record = data?.record;

  if (isLoading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <div className="spinner-border text-secondary" role="status" />
      </div>
    );
  }

  if (isError || !record) {
    return (
      <div className="empty-state">
        <i className="bi bi-exclamation-triangle" />
        <div>Submission not found, or you don't have access to it.</div>
      </div>
    );
  }

  return (
    <div>
      <a href={`/projects/${encodeURIComponent(record.project)}`} className="back-link mb-2 d-inline-flex">
        <i className="bi bi-arrow-left" /> {record.project}
      </a>

      <PageHero
        theme="navyblue"
        icon="bi-file-earmark-text"
        title={`Submission: ${record.submission_name}`}
        meta={`#${record.id} · ${record.project} · ${record.client}`}
      />

      <SubmissionOverview records={[record]} canEdit={canEdit} onRefetch={refetch} />
    </div>
  );
}
