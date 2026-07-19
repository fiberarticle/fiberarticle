import { Suspense } from "react";
import { RunView } from "@/components/run-view";

export const metadata = { title: "Literature Reviewer" };

export default async function LiteratureReviewerRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <RunView runId={id} />
    </Suspense>
  );
}
