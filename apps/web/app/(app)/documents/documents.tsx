"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";
import type { DocumentListItem } from "@/lib/types";

const templateLabels: Record<string, string> = {
  generic: "Generic manuscript",
  ieee: "IEEE",
  apa: "APA 7",
};

export function Documents() {
  const [documents, setDocuments] = useState<DocumentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      apiFetch<DocumentListItem[]>("/v1/documents")
        .then(setDocuments)
        .catch((e) =>
          setError(
            e instanceof ApiError
              ? e.message
              : "The Fiberarticle API is unreachable."
          )
        );
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Publication-ready articles generated from your research runs.
        </p>
      </div>

      {error && <Callout tone="error">{error}</Callout>}

      {documents === null && !error ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : documents && documents.length === 0 ? (
        <Card className="flex flex-col items-center gap-1 border-dashed bg-transparent p-10 text-center shadow-none">
          <FileText className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No documents yet. Open a completed research run and choose
            &quot;Generate article&quot;.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {documents?.map((doc) => (
            <Link key={doc.id} href={`/documents/${doc.id}`}>
              <Card className="group flex items-center justify-between gap-4 p-4 transition-colors hover:bg-accent">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{doc.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {templateLabels[doc.template] ?? doc.template} ·{" "}
                    {doc.section_count} sections · updated{" "}
                    {new Date(doc.updated_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {doc.status === "generating" ? (
                    <TextShimmer className="text-xs">Writing...</TextShimmer>
                  ) : doc.status === "failed" ? (
                    <Badge variant="destructive">failed</Badge>
                  ) : (
                    <Badge variant="success">ready</Badge>
                  )}
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
