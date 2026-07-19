import { Suspense } from "react";
import { LegacyRunRedirect } from "./redirect";

// Legacy URL: /runs/<id> predates the feature-named routes. The stub looks
// up the run's mode and forwards to /researcher/<id> or
// /literature-reviewer/<id>, so old links and bookmarks keep working.
export const metadata = { title: { absolute: "Fiberarticle" } };

export default async function LegacyRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <LegacyRunRedirect runId={id} />
    </Suspense>
  );
}
