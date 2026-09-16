"use client";
import AppLayout from "../../../components/AppLayout";
import SubmissionsDrilldown from "../../../components/SubmissionsDrilldown";

function decodeSegment(v) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v; // not valid percent-encoding — use as-is rather than throwing
  }
}

export default function ClientSubmissionsPage({ params }) {
  // Next gives us the raw URL segment here (still percent-encoded, e.g. "100%20Allstate%20Road"),
  // so it must be decoded before use — otherwise it's sent to the API literally and never matches.
  const name = decodeSegment(params.name);
  return (
    <AppLayout>
      <SubmissionsDrilldown by="client" name={name} />
    </AppLayout>
  );
}
