"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import type { RunDetail } from "@/lib/types";

export function LegacyRunRedirect({ runId }: { runId: string }) {
  const router = useRouter();

  React.useEffect(() => {
    let cancelled = false;
    apiFetch<RunDetail>(`/v1/runs/${runId}`)
      .then((run) => {
        if (cancelled) return;
        const base =
          run.mode === "literature_review"
            ? "/literature-reviewer"
            : "/researcher";
        router.replace(`${base}/${runId}${window.location.search}`);
      })
      .catch(() => {
        if (!cancelled) router.replace("/dashboard");
      });
    return () => {
      cancelled = true;
    };
  }, [runId, router]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}
