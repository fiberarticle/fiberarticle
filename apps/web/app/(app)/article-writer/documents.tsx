"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, PenLine } from "lucide-react";
import { WriterArt } from "@/components/art";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiError } from "@/lib/api";
import type { DocumentListItem, Run } from "@/lib/types";

const templateLabels: Record<string, string> = {
  generic: "Generic manuscript",
  ieee: "IEEE",
  apa: "APA 7",
  acm: "ACM",
  elsevier: "Elsevier",
  springer: "Springer Nature",
  neurips: "NeurIPS",
};

export function Documents() {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [starting, setStarting] = useState(false);

  // Same flow as the home page's Article Writer card: research the topic
  // first, then the article is generated automatically when it completes.
  async function onStartArticle() {
    setError(null);
    const trimmed = topic.trim();
    if (trimmed.length < 10) {
      setError("Describe your topic in at least 10 characters.");
      return;
    }
    setStarting(true);
    try {
      const run = await apiFetch<Run>("/v1/runs", {
        method: "POST",
        body: JSON.stringify({ topic: trimmed, mode: "research" }),
      });
      sessionStorage.setItem(`fa-article-intent-${run.id}`, "1");
      router.push(`/researcher/${run.id}?intent=article`);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "The Fiberarticle API is unreachable. Is it running?"
      );
      setStarting(false);
    }
  }

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
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Articles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Publication-ready articles generated from your research runs.
          </p>
        </div>
        <WriterArt className="hidden w-36 shrink-0 sm:block" />
      </div>

      <Card className="flex flex-col gap-3 p-5">
        <Textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Example: Retrieval-augmented generation techniques for reducing hallucination in large language models"
          className="min-h-20"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onStartArticle();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            The agent researches the topic first, then writes the full
            article and opens it in the editor.
          </p>
          <Button
            onClick={onStartArticle}
            loading={starting}
            disabled={!topic.trim()}
          >
            <PenLine /> Write article
          </Button>
        </div>
      </Card>

      {error && <Callout tone="error">{error}</Callout>}

      {documents === null && !error ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : documents && documents.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 border-dashed bg-transparent p-10 text-center shadow-none">
          <WriterArt className="w-36" />
          <p className="text-sm text-muted-foreground">
            No articles yet. Open a completed research run and choose
            &quot;Generate article&quot;.
          </p>
        </Card>
      ) : (
        <div className="fa-textarea-scroll -mr-3 flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-3">
          {documents?.map((doc) => (
            <Link key={doc.id} href={`/article-writer/${doc.id}`}>
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
