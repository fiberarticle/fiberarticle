"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  FileText,
  Library,
  Lightbulb,
  Paperclip,
  Search,
} from "lucide-react";
import { AskArt } from "@/components/art";
import { AttachmentBadge } from "@/components/agent-composer";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from "@/components/prompt-kit/chain-of-thought";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/prompt-kit/prompt-input";
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
import { apiFetch, ApiError, apiUrl, getApiToken } from "@/lib/api";
import type { ChatMessage, Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Assistant() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paperIdParam = searchParams.get("paper");
  const chatIdParam = searchParams.get("chat");

  const [conversations, setConversations] = React.useState<Conversation[] | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const startedForPaper = React.useRef(false);
  // Set while the first message of a fresh chat is in flight so the
  // thread loader does not clobber the optimistic message with [].
  const sendingFirstFor = React.useRef<string | null>(null);

  // The open conversation is fully URL-driven: /assistant?chat=<id>.
  const activeId = chatIdParam;
  const active = conversations?.find((c) => c.id === activeId) ?? null;

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
      router.replace(`/assistant?chat=${existing.id}`);
      return;
    }
    (async () => {
      try {
        const created = await apiFetch<Conversation>("/v1/chats", {
          method: "POST",
          body: JSON.stringify({ scope: "paper", paper_id: paperIdParam }),
        });
        await loadConversations();
        router.replace(`/assistant?chat=${created.id}`);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not open the chat.");
      }
    })();
  }, [paperIdParam, conversations, loadConversations, router]);

  // Deep link from the New Task composer: /assistant?q=<question> starts a
  // fresh chat with that question straight away.
  const autoAsked = React.useRef(false);
  const qParam = (searchParams.get("q") ?? "").trim();
  React.useEffect(() => {
    if (!qParam || autoAsked.current || chatIdParam) return;
    autoAsked.current = true;
    setStarting(true);
    startChatWith(qParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam, chatIdParam]);

  React.useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    if (sendingFirstFor.current === activeId) return;
    apiFetch<ChatMessage[]>(`/v1/chats/${activeId}/messages`)
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [activeId]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending]);

  function onAttach(files: File[]) {
    setError(null);
    setAttachments((prev) => {
      const merged = [...prev];
      for (const file of files) {
        const duplicate = merged.some(
          (f) => f.name === file.name && f.size === file.size
        );
        if (!duplicate) merged.push(file);
      }
      return merged.slice(0, 10);
    });
  }

  /** Upload every attachment into the library so the chat can read them.
   * Returns false (and reports errors) if any upload failed. */
  async function uploadAttachments(): Promise<boolean> {
    if (attachments.length === 0) return true;
    setUploading(true);
    const failures: string[] = [];
    try {
      const token = await getApiToken();
      for (const file of attachments) {
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch(apiUrl("/v1/papers/upload"), {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            failures.push(`${file.name}: ${body.detail ?? "upload failed"}`);
          }
        } catch {
          failures.push(`${file.name}: upload failed`);
        }
      }
    } finally {
      setUploading(false);
    }
    if (failures.length > 0) {
      setError(`Some attachments were not added: ${failures.join("; ")}`);
      // Keep only the failed files so the user can fix or remove them.
      setAttachments((prev) =>
        prev.filter((f) => failures.some((msg) => msg.startsWith(f.name)))
      );
      return false;
    }
    setAttachments([]);
    return true;
  }

  /** Create a library chat and send the question in one go. */
  async function startChatWith(trimmed: string) {
    try {
      const created = await apiFetch<Conversation>("/v1/chats", {
        method: "POST",
        body: JSON.stringify({ scope: "library" }),
      });
      sendingFirstFor.current = created.id;
      setMessages([
        {
          id: -1,
          role: "user",
          content: trimmed,
          citations: null,
          steps: null,
          created_at: new Date().toISOString(),
        },
      ]);
      setSending(true);
      setDraft("");
      loadConversations();
      router.push(`/assistant?chat=${created.id}`);
      const updated = await apiFetch<ChatMessage[]>(
        `/v1/chats/${created.id}/messages`,
        { method: "POST", body: JSON.stringify({ content: trimmed }) }
      );
      setMessages(updated);
      loadConversations();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the chat.");
    } finally {
      sendingFirstFor.current = null;
      setSending(false);
      setStarting(false);
    }
  }

  /** Landing input: upload any attachments first, then start the chat. */
  async function onStartChat() {
    const trimmed = draft.trim();
    if (!trimmed || starting) return;
    setStarting(true);
    setError(null);
    if (!(await uploadAttachments())) {
      setStarting(false);
      return;
    }
    await startChatWith(trimmed);
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
        steps: null,
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

  // ------------------------------------------------------------ chat view
  if (activeId) {
    return (
      <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-3xl flex-col">
        <div className="mb-3 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            onClick={() => router.push("/assistant")}
          >
            <ArrowLeft /> Assistant
          </Button>
          {active && (
            <>
              <Badge variant={active.scope === "paper" ? "default" : "leaf"}>
                {active.scope === "paper" ? "Paper" : "Library"}
              </Badge>
              <span className="truncate text-sm font-medium">{active.title}</span>
            </>
          )}
        </div>

        {error && (
          <div className="mb-3">
            <Callout tone="error">{error}</Callout>
          </div>
        )}

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
                {/* The agent's chain of thought, collapsed above the answer. */}
                {message.role === "assistant" &&
                  message.steps &&
                  message.steps.length > 0 && (
                    <div className="mb-1">
                      <ChainOfThought>
                        <ChainOfThoughtStep isLast>
                          <ChainOfThoughtTrigger leftIcon={<Lightbulb />} status="done">
                            Reasoning
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {message.steps.length}{" "}
                              {message.steps.length === 1 ? "step" : "steps"}
                            </span>
                          </ChainOfThoughtTrigger>
                          <ChainOfThoughtContent>
                            {message.steps.map((step, si) => (
                              <ChainOfThoughtItem key={si}>
                                {step.type === "action" ? (
                                  <span className="flex items-start gap-1.5">
                                    {step.tool === "library_search" ? (
                                      <Library className="mt-0.5 size-3.5 shrink-0" />
                                    ) : (
                                      <Search className="mt-0.5 size-3.5 shrink-0" />
                                    )}
                                    <span>
                                      {step.tool === "library_search"
                                        ? "Searched your library"
                                        : "Searched the literature"}
                                      {step.input ? `: "${step.input}"` : ""}
                                    </span>
                                  </span>
                                ) : (
                                  step.text
                                )}
                              </ChainOfThoughtItem>
                            ))}
                          </ChainOfThoughtContent>
                        </ChainOfThoughtStep>
                      </ChainOfThought>
                    </div>
                  )}
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
                      <Source key={ci} href={citation.url ?? undefined}>
                        <SourceTrigger label={`[${ci + 1}] ${citation.title}`} />
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
                Thinking, searching, and reading sources
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
            placeholder="Ask follow ups..."
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
      </div>
    );
  }

  // --------------------------------------------------------- landing view
  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-3xl flex-col justify-center gap-6">
      <AskArt className="mx-auto -mb-2 w-44" />
      <h1 className="text-center text-3xl font-semibold tracking-tight">
        What do you want to know?
      </h1>
      <p className="-mt-3 text-center text-sm text-muted-foreground">
        Ask across your library or upload a paper first. Every answer cites the
        exact passages it used.
      </p>

      {error && <Callout tone="error">{error}</Callout>}

      <PromptInput
        isLoading={starting}
        value={draft}
        onValueChange={setDraft}
        onSubmit={onStartChat}
        className="w-full rounded-[26px] border-2 border-[color-mix(in_oklab,var(--border)_78%,var(--muted-foreground))] bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--card)_88%,white),color-mix(in_oklab,var(--card)_97%,white)_50%)] shadow-[inset_0_1.5px_0_var(--classic-highlight),0_24px_60px_-26px_rgba(0,0,0,0.65)]"
      >
        <div className="flex flex-col">
          <PromptInputTextarea
            placeholder="Ask a question about the papers in your library..."
            aria-label="Message for Assistant"
            className="min-h-24 px-5 pt-5"
          />
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 px-4">
              {attachments.map((file, index) => (
                <AttachmentBadge
                  key={`${file.name}-${file.size}-${index}`}
                  file={file}
                  onRemove={() =>
                    setAttachments((prev) => prev.filter((_, i) => i !== index))
                  }
                />
              ))}
            </div>
          )}
          <PromptInputActions className="mt-3 w-full justify-between px-3 pb-3">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) onAttach(files);
                  e.target.value = "";
                }}
              />
              <PromptInputAction tooltip="Attach papers (PDF, Word, text)">
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="rounded-full"
                  type="button"
                  aria-label="Attach files"
                  disabled={starting}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip />
                </Button>
              </PromptInputAction>
            </div>
            <Button
              size="icon"
              className="rounded-2xl"
              disabled={!draft.trim() || starting}
              onClick={onStartChat}
              aria-label="Send"
            >
              {starting ? (
                <span className="size-3 rounded-xs bg-primary-foreground" />
              ) : (
                <ArrowUp />
              )}
            </Button>
          </PromptInputActions>
        </div>
      </PromptInput>

      {starting && (
        <div className="text-center">
          <TextShimmer className="text-sm">
            {uploading
              ? "Adding your papers to the library"
              : "Starting your chat"}
          </TextShimmer>
        </div>
      )}

      <div>
        <h2 className="mb-2.5 text-sm font-semibold text-muted-foreground">
          Your conversations
        </h2>
        {conversations === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No conversations yet. Ask a question above, or open a paper and
            choose Chat.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => router.push(`/assistant?chat=${c.id}`)}
                className="w-full text-left"
              >
                <Card className="flex cursor-pointer items-center justify-between gap-3 p-4 transition-colors hover:bg-accent">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {c.scope === "paper" ? (
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Library className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(c.updated_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
