"use client";
import AppLayout from "../../../components/AppLayout";
import SubmissionDetail from "../../../components/SubmissionDetail";

export default function RecordDetailPage({ params }) {
  return (
    <AppLayout>
      <SubmissionDetail id={params.id} />
    </AppLayout>
  );
}
