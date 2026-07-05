"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUp, FileText, Library, Plus, Trash2 } from "lucide-react";
import { AssistantArt } from "@/components/art";
import {
  Source,
  SourceContent,
  SourceTrigger,
} from "@/components/prompt-kit/source";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";
import type { ChatMessage, Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Assistant() {
  const searchParams = useSearchParams();
  const paperIdParam = searchParams.get("paper");

  const [conversations, setConversations] = React.useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const startedForPaper = React.useRef(false);

  const loadConversations = React.useCallback(async () => {
    try {
      const rows = await apiFetch<Conversation[]>("/v1/chats");
      setConversations(rows);
      return rows;
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "The Fiberarticle API is unreachable."
      );
      return [];
    }
  }, []);

  React.useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Deep link: /assistant?paper=<id> opens (or creates) a chat for that paper.
  React.useEffect(() => {
    if (!paperIdParam || startedForPaper.current || conversations === null) return;
    startedForPaper.current = true;
    const existing = conversations.find((c) => c.paper_id === paperIdParam);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    (async () => {
      try {
        const created = await apiFetch<Conversation>("/v1/chats", {
          method: "POST",
          body: JSON.stringify({ scope: "paper", paper_id: paperIdParam }),
        });
        await loadConversations();
        setActiveId(created.id);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not open the chat.");
      }
    })();
  }, [paperIdParam, conversations, loadConversations]);

  React.useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    apiFetch<ChatMessage[]>(`/v1/chats/${activeId}/messages`)
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [activeId]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  async function onNewLibraryChat() {
    setError(null);
    try {
      const created = await apiFetch<Conversation>("/v1/chats", {
        method: "POST",
        body: JSON.stringify({ scope: "library" }),
      });
      await loadConversations();
      setActiveId(created.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start a chat.");
    }
  }

  async function onDelete(conversationId: string) {
    await apiFetch(`/v1/chats/${conversationId}`, { method: "DELETE" });
    if (activeId === conversationId) setActiveId(null);
    loadConversations();
  }

  async function onSend() {
    const trimmed = input.trim();
    if (!trimmed || !activeId || sending) return;
    setSending(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      {
        id: -1,
        role: "user",
        content: trimmed,
        citations: null,
        created_at: new Date().toISOString(),
      },
    ]);
    setInput("");
    try {
      const updated = await apiFetch<ChatMessage[]>(
        `/v1/chats/${activeId}/messages`,
        { method: "POST", body: JSON.stringify({ content: trimmed }) }
      );
      setMessages(updated);
      loadConversations();
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== -1));
      setInput(trimmed);
      setError(e instanceof ApiError ? e.message : "The message failed to send.");
    } finally {
      setSending(false);
    }
  }

  const active = conversations?.find((c) => c.id === activeId) ?? null;

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-5xl gap-5">
      <aside className="hidden w-64 shrink-0 flex-col gap-2 md:flex">
        <Button variant="secondary" onClick={onNewLibraryChat}>
          <Plus /> New library chat
        </Button>
        <div className="flex flex-col gap-1 overflow-y-auto">
          {conversations === null ? (
            <>
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              No conversations yet. Start a library chat or open a paper and
              choose Chat.
            </p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition-colors",
                  activeId === c.id
                    ? "bg-leaf-soft text-leaf"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
                onClick={() => setActiveId(c.id)}
              >
                {c.scope === "paper" ? (
                  <FileText className="size-3.5 shrink-0" />
                ) : (
                  <Library className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <button
                  aria-label="Delete conversation"
                  className="hidden cursor-pointer text-muted-foreground hover:text-destructive group-hover:block"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="mb-3">
            <Callout tone="error">{error}</Callout>
          </div>
        )}

        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <AssistantArt className="w-48" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Chat with your papers
            </h1>
            <p className="max-w-md text-sm text-muted-foreground">
              Ask questions across your whole library or a single paper. Every
              answer cites the exact passages it used.
            </p>
            <Button onClick={onNewLibraryChat}>
              <Plus /> Start a library chat
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <Badge variant={active.scope === "paper" ? "default" : "leaf"}>
                {active.scope === "paper" ? "Paper" : "Library"}
              </Badge>
              <span className="truncate text-sm font-medium">{active.title}</span>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              <div className="flex flex-col gap-4 pb-4">
                {messages.length === 0 && !sending && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Ask your first question.
                  </p>
                )}
                {messages.map((message, i) => (
                  <div
                    key={`${message.id}-${i}`}
                    className={cn(
                      "max-w-[85%]",
                      message.role === "user" ? "self-end" : "self-start"
                    )}
                  >
                    <Card
                      className={cn(
                        "px-4 py-3",
                        message.role === "user" &&
                          "border-transparent bg-[color-mix(in_oklab,var(--primary)_14%,transparent)]"
                      )}
                    >
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {message.content}
                      </p>
                    </Card>
                    {message.citations && message.citations.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {message.citations.map((citation, ci) => (
                          <Source key={ci}>
                            <SourceTrigger
                              label={`[${ci + 1}] ${citation.title}`}
                            />
                            <SourceContent
                              title={citation.title}
                              description={`"${citation.quote}"`}
                            />
                          </Source>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {sending && (
                  <TextShimmer className="self-start text-sm">
                    Reading the relevant passages
                  </TextShimmer>
                )}
                <div ref={bottomRef} />
              </div>
            </div>

            <div className="mt-2 flex items-end gap-2 rounded-3xl border border-border bg-card p-2 shadow-[0_2px_12px_rgba(0,0,0,0.06)] focus-within:border-ring">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                }}
                rows={1}
                placeholder={
                  active.scope === "paper"
                    ? "Ask about this paper..."
                    : "Ask across your whole library..."
                }
                className="max-h-40 flex-1 resize-none border-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <Button
                size="icon"
                className="rounded-full"
                disabled={!input.trim() || sending}
                onClick={onSend}
                aria-label="Send"
              >
                <ArrowUp />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
