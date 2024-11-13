import { Suspense } from "react";
import { RunView } from "@/components/run-view";

export const metadata = { title: "Researcher" };

export default async function ResearcherRunPage({
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
