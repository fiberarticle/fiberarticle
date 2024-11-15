"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Globe,
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
import { StarBorder } from "@/components/star-border";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError, apiUrl, getApiToken } from "@/lib/api";
import { streamChatMessage, type SseHandle } from "@/lib/sse";
import type { ChatMessage, ChatStep, Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ChatContext {
  used_tokens: number;
  context_window: number;
  percent: number;
}

/** "3.4k", "128k", "999" - compact token counts for the context meter. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** Inline markdown marks: **bold**, *italic*, `code`. Anything unmatched
 * stays literal, so a stray asterisk can never corrupt the message. */
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 text-[13px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

/** Lightweight markdown for assistant replies: paragraphs, bullet and
 * numbered lists, and inline marks. No raw ** ever reaches the screen. */
function MessageText({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2.5 text-sm leading-6">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (lines.length === 0) return null;
        const isBullet = lines.every((l) => /^\s*[-*+]\s+/.test(l));
        const isNumbered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
        if (isBullet || isNumbered) {
          const List = isBullet ? "ul" : "ol";
          return (
            <List
              key={bi}
              className={cn(
                "flex list-outside flex-col gap-1 pl-5",
                isBullet ? "list-disc" : "list-decimal"
              )}
            >
              {lines.map((line, li) => (
                <li key={li}>
                  {renderInline(
                    line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
                  )}
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={bi} className="whitespace-pre-wrap">
            {lines.map((line, li) => (
              <React.Fragment key={li}>
                {li > 0 && <br />}
                {renderInline(line.replace(/^#{1,4}\s+/, ""))}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** One chain-of-thought line: a tool action with its icon, or a thought. */
function StepLine({ step }: { step: ChatStep }) {
  if (step.type === "action") {
    return (
      <span className="flex items-start gap-1.5">
        {step.tool === "library_search" ? (
          <Library className="mt-0.5 size-3.5 shrink-0" />
        ) : step.tool === "web_search" ? (
          <Globe className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <Search className="mt-0.5 size-3.5 shrink-0" />
        )}
        <span>
          {step.tool === "library_search"
            ? "Searched your papers"
            : step.tool === "web_search"
              ? "Searched the web"
              : "Searched the literature"}
          {step.input ? `: "${step.input}"` : ""}
        </span>
      </span>
    );
  }
  return <>{step.text}</>;
}

/** "25 July 2026 10:33 PM" - full date so old messages stay unambiguous. */
function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} ${time}`;
}

export function Assistant({ chatId }: { chatId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Path param (/assistant/<id>) is the canonical deep link; the legacy
  // ?chat= query form still resolves for old links.
  const chatIdParam = chatId ?? searchParams.get("chat");

  const [conversations, setConversations] = React.useState<Conversation[] | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  // Which conversation the in-flight exchange belongs to: the live steps,
  // spinner, and stop button only render inside that chat.
  const [sendingFor, setSendingFor] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Chain of thought streamed live for the exchange currently in flight.
  const [liveSteps, setLiveSteps] = React.useState<ChatStep[]>([]);
  const [liveOpen, setLiveOpen] = React.useState(true);
  // Handle of the open SSE stream; closing it is the stop button.
  const streamRef = React.useRef<SseHandle | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const followUpRef = React.useRef<HTMLTextAreaElement>(null);
  // Set while the first message of a fresh chat is in flight so the
  // thread loader does not clobber the optimistic message with [].
  const sendingFirstFor = React.useRef<string | null>(null);
  // Which message's copy icon shows the "copied" check right now.
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);
  // Approximate context-window usage of the open conversation.
  const [chatContext, setChatContext] = React.useState<ChatContext | null>(null);

  async function onCopyMessage(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      // Clipboard unavailable (permissions): silently do nothing.
    }
  }

  // The open conversation is fully URL-driven: /assistant?chat=<id>.
  const activeId = chatIdParam;
  const active = conversations?.find((c) => c.id === activeId) ?? null;
  // Live ref of the open chat, so stream callbacks that finish minutes
  // later can never write another conversation's messages on screen.
  const activeIdRef = React.useRef(activeId);
  React.useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

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

  // Deep link from the New Task composer: /assistant?q=<question> starts a
  // fresh chat with that question straight away. attached=1 means files
  // were just uploaded, so the agent must consult the library first.
  const autoAsked = React.useRef(false);
  const qParam = (searchParams.get("q") ?? "").trim();
  const attachedParam = searchParams.get("attached") === "1";
  React.useEffect(() => {
    if (!qParam || autoAsked.current || chatIdParam) return;
    autoAsked.current = true;
    setStarting(true);
    startChatWith(qParam, attachedParam);
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
  }, [messages.length, sending, liveSteps.length]);

  // Refresh the context meter when the chat opens and after every exchange.
  React.useEffect(() => {
    if (!activeId) {
      setChatContext(null);
      return;
    }
    apiFetch<ChatContext>(`/v1/chats/${activeId}/context`)
      .then(setChatContext)
      .catch(() => setChatContext(null));
  }, [activeId, messages.length]);

  // Real elapsed time while the agent works: reasoning models on the free
  // tier can legitimately take minutes, and a static shimmer reads as hung.
  const [thinkSeconds, setThinkSeconds] = React.useState(0);
  React.useEffect(() => {
    if (!sending) return;
    setThinkSeconds(0);
    const interval = setInterval(() => setThinkSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [sending]);
  const thinkElapsed =
    thinkSeconds >= 60
      ? `${Math.floor(thinkSeconds / 60)}m ${thinkSeconds % 60}s`
      : `${thinkSeconds}s`;

  // Compact chat bar: grows with the message, capped well before it
  // dominates the screen, then scrolls internally.
  const FOLLOW_UP_MAX_HEIGHT = 160;
  React.useLayoutEffect(() => {
    const el = followUpRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, FOLLOW_UP_MAX_HEIGHT)}px`;
  }, [input]);

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
      return merged;
    });
  }

  /** Upload every attachment into the user's paper pool so the chat can read them.
   * Returns the created paper ids, or null if any upload failed. */
  async function uploadAttachments(): Promise<string[] | null> {
    if (attachments.length === 0) return [];
    setUploading(true);
    const failures: string[] = [];
    const uploaded: string[] = [];
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
          } else {
            const body = await res.json().catch(() => null);
            if (body?.id) uploaded.push(body.id);
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
      return null;
    }
    setAttachments([]);
    return uploaded;
  }

  /** One streamed exchange: agent steps arrive live, the final message
   * list lands in one go. Resolves when the stream is over, however it
   * ended (answer, stop, or failure). */
  function runExchange(
    chatId: string,
    content: string,
    searchLibraryFirst: boolean
  ): Promise<void> {
    setLiveSteps([]);
    setLiveOpen(true);
    return new Promise((resolve) => {
      // Every message write is gated on the chat still being the one on
      // screen; a reply that lands after switching chats must not replace
      // the other conversation's thread.
      const isCurrent = () => activeIdRef.current === chatId;
      const refresh = (delayMs: number) => {
        // The server persists the stopped/failed exchange on its own time;
        // a short delay keeps this read after that write.
        setTimeout(() => {
          if (isCurrent()) {
            apiFetch<ChatMessage[]>(`/v1/chats/${chatId}/messages`)
              .then((msgs) => {
                if (isCurrent()) setMessages(msgs);
              })
              .catch(() => {});
          }
          loadConversations();
        }, delayMs);
      };
      const finish = () => {
        streamRef.current = null;
        setLiveSteps([]);
        resolve();
      };
      streamRef.current = streamChatMessage(
        chatId,
        { content, search_library_first: searchLibraryFirst },
        {
          onStep: (step) => {
            if (isCurrent()) setLiveSteps((prev) => [...prev, step]);
          },
          onDone: (msgs) => {
            if (isCurrent()) setMessages(msgs);
            loadConversations();
            finish();
          },
          onError: (message) => {
            if (isCurrent()) {
              setError(message);
              setInput((current) => current || content);
            }
            // Server truth: the question (and maybe a reply) may or may
            // not have been saved depending on where it failed.
            refresh(300);
            finish();
          },
          onAbort: () => {
            refresh(400);
            finish();
          },
        }
      );
    });
  }

  /** The stop button: closing the stream cancels the agent server-side. */
  function onStopResponse() {
    streamRef.current?.close();
  }

  /** Create a chat and send the question in one go. When files were
   * attached, the agent is told to search the user's papers first so the
   * freshly uploaded documents are always consulted. */
  async function startChatWith(trimmed: string, searchLibraryFirst = false) {
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
      setSendingFor(created.id);
      setDraft("");
      loadConversations();
      router.push(`/assistant/${created.id}`);
      await runExchange(created.id, trimmed, searchLibraryFirst);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the chat.");
    } finally {
      sendingFirstFor.current = null;
      setSending(false);
      setSendingFor(null);
      setStarting(false);
    }
  }

  /** Landing input: upload any attachments first, then start the chat. */
  async function onStartChat() {
    const trimmed = draft.trim();
    if (!trimmed || starting) return;
    setStarting(true);
    setError(null);
    const uploadedIds = await uploadAttachments();
    if (uploadedIds === null) {
      setStarting(false);
      return;
    }
    await startChatWith(trimmed, uploadedIds.length > 0);
  }

  async function onSend() {
    const trimmed = input.trim();
    if (!trimmed || !activeId || sending) return;
    setSending(true);
    setError(null);
    // Attached files (picked or pasted) go into the paper pool first so the
    // agent is forced to consult them for this question.
    const uploadedIds = await uploadAttachments();
    if (uploadedIds === null) {
      setSending(false);
      return;
    }
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
    setSendingFor(activeId);
    await runExchange(activeId, trimmed, uploadedIds.length > 0);
    setSending(false);
    setSendingFor(null);
  }

  /** Ctrl+V with files on the clipboard attaches them instead of pasting. */
  function onPasteFiles(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      onAttach(files);
    }
  }

  // ------------------------------------------------------------ chat view
  if (activeId) {
    return (
      // No inner scroll container: the inset panel itself scrolls, so the
      // only scrollbar sits at the panel's right edge (Claude style). The
      // header and the reply bar stick to the panel's top and bottom.
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col">
        <div className="sticky top-0 z-20 -mt-8 flex items-center gap-2 bg-background pb-3 pt-8">
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
                {active.scope === "paper" ? "Paper" : "Chat"}
              </Badge>
              <span className="min-w-0 truncate text-sm font-medium">
                {active.title}
              </span>
            </>
          )}
        </div>

        {error && (
          <div className="mb-3">
            <Callout tone="error">{error}</Callout>
          </div>
        )}

        <div className="flex-1">
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
                  "group/msg max-w-[85%]",
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
                                <StepLine step={step} />
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
                  {message.role === "assistant" ? (
                    <MessageText content={message.content} />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-6">
                      {message.content}
                    </p>
                  )}
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
                {/* Sent time plus a bare copy icon, ChatGPT/Claude style:
                    hidden until the message is hovered (or just copied). */}
                <div
                  className={cn(
                    "mt-1 flex items-center gap-1.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/msg:opacity-100",
                    copiedKey === `${message.id}-${i}` && "opacity-100",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <span className="text-[11px] text-muted-foreground">
                    {formatMessageTime(message.created_at)}
                  </span>
                  <button
                    type="button"
                    aria-label="Copy message"
                    title="Copy message"
                    onClick={() =>
                      onCopyMessage(`${message.id}-${i}`, message.content)
                    }
                    className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {copiedKey === `${message.id}-${i}` ? (
                      <Check className="size-3 text-success" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </button>
                </div>
              </div>
            ))}
            {sending && sendingFor === activeId && (
              <div className="max-w-[85%] self-start">
                {/* The chain of thought streams in live, Claude style:
                    each step appears the moment the agent takes it. */}
                {liveSteps.length > 0 && (
                  <div className="mb-2">
                    <ChainOfThought>
                      <ChainOfThoughtStep
                        isLast
                        open={liveOpen}
                        onOpenChange={setLiveOpen}
                      >
                        <ChainOfThoughtTrigger
                          leftIcon={<Lightbulb />}
                          status="active"
                        >
                          <TextShimmer>Reasoning</TextShimmer>
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {liveSteps.length}{" "}
                            {liveSteps.length === 1 ? "step" : "steps"}
                          </span>
                        </ChainOfThoughtTrigger>
                        <ChainOfThoughtContent>
                          {liveSteps.map((step, si) => (
                            <ChainOfThoughtItem key={si}>
                              <StepLine step={step} />
                            </ChainOfThoughtItem>
                          ))}
                        </ChainOfThoughtContent>
                      </ChainOfThoughtStep>
                    </ChainOfThought>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <TextShimmer className="text-sm">
                    {liveSteps.length > 0
                      ? "Working on the answer"
                      : "Thinking, searching, and reading sources"}
                  </TextShimmer>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {thinkElapsed}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="sticky bottom-0 z-20 -mb-8 bg-background pb-4 pt-2">
        <StarBorder
          radius={24}
          borderWidth={1.5}
          lightWidth={140}
          className="shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
        >
        <div className="flex flex-col rounded-[22px] bg-card p-2">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
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
          <div className="flex items-end gap-2">
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
            <Button
              variant="outline"
              size="icon-sm"
              className="mb-0.5 rounded-full"
              type="button"
              aria-label="Attach files"
              disabled={sending || uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip />
            </Button>
            <textarea
              ref={followUpRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={onPasteFiles}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              rows={1}
              placeholder="Ask follow ups..."
              className="fa-textarea-scroll max-h-40 flex-1 resize-none overflow-y-auto border-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none transition-[height] duration-150 ease-out placeholder:text-muted-foreground"
            />
            <Button
              size="icon"
              className="rounded-full"
              disabled={
                sending ? sendingFor !== activeId : !input.trim()
              }
              onClick={
                sending && sendingFor === activeId ? onStopResponse : onSend
              }
              aria-label={
                sending && sendingFor === activeId ? "Stop response" : "Send"
              }
              title={
                sending && sendingFor === activeId ? "Stop response" : "Send"
              }
            >
              {sending && sendingFor === activeId ? (
                <span className="size-3 rounded-xs bg-primary-foreground" />
              ) : (
                <ArrowUp />
              )}
            </Button>
          </div>
        </div>
        </StarBorder>
        {chatContext && (
          <div
            className="mt-1.5 flex items-center justify-end gap-2 px-2"
            title="Approximate share of the model's context window this conversation uses"
          >
            <span className="text-[11px] tabular-nums text-muted-foreground">
              Context {formatTokens(chatContext.used_tokens)} /{" "}
              {formatTokens(chatContext.context_window)} (
              {Math.round(chatContext.percent)}%)
            </span>
            <span className="h-1 w-24 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-[#4f90e4] transition-[width] duration-500"
                style={{ width: `${Math.min(100, chatContext.percent)}%` }}
              />
            </span>
          </div>
        )}
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
        Upload a paper first or ask directly. Every answer cites the exact
        passages it used.
      </p>

      {error && <Callout tone="error">{error}</Callout>}

      <StarBorder
        radius={26}
        className="w-full shadow-[0_24px_60px_-26px_rgba(0,0,0,0.65)]"
      >
      <PromptInput
        isLoading={starting}
        value={draft}
        onValueChange={setDraft}
        onSubmit={onStartChat}
        className="w-full rounded-[24px] border-0 bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--card)_88%,white),color-mix(in_oklab,var(--card)_97%,white)_50%)] shadow-[inset_0_1.5px_0_var(--classic-highlight)]"
      >
        <div className="flex flex-col">
          <PromptInputTextarea
            placeholder="Ask a question about your papers or any research topic..."
            aria-label="Message for Assistant"
            className="min-h-32 px-5 pt-5"
            onPaste={onPasteFiles}
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
              disabled={starting ? false : !draft.trim()}
              onClick={starting ? onStopResponse : onStartChat}
              aria-label={starting ? "Stop response" : "Send"}
              title={starting ? "Stop response" : "Send"}
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
      </StarBorder>

      {starting && (
        <div className="text-center">
          <TextShimmer className="text-sm">
            {uploading
              ? "Adding your papers"
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
            No conversations yet. Ask a question above to get started.
          </p>
        ) : (
          <div className="fa-textarea-scroll -mr-3 flex max-h-[42vh] flex-col gap-2 overflow-y-auto pr-3">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => router.push(`/assistant/${c.id}`)}
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
