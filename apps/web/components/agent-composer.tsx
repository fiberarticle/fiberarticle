"use client";

import * as React from "react";
import {
  ArrowUp,
  BookOpenCheck,
  Check,
  FileText,
  HatGlasses,
  Paperclip,
  PenLine,
  UserRound,
  X,
} from "lucide-react";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/prompt-kit/prompt-input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPTED_FILES = ".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp";

/** Small rectangle badge for one attachment: preview, name, remove cross. */
export function AttachmentBadge({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const [preview, setPreview] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const sizeLabel =
    file.size > 1_048_576
      ? `${(file.size / 1_048_576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.size / 1024))} KB`;

  return (
    <span className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 py-1.5 pl-1.5 pr-1 text-xs">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt=""
          className="size-7 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] text-primary">
          <FileText className="size-4" />
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="max-w-40 truncate font-medium">{file.name}</span>
        <span className="text-[10px] text-muted-foreground">{sizeLabel}</span>
      </span>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="ml-0.5 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

export type AgentMode = "researcher" | "article" | "review" | "assistant";


interface AgentDef {
  id: AgentMode;
  label: string;
  tagline: string;
  placeholder: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Brand accent from the Fiberarticle logo palette. */
  accent: string;
  // Fan geometry: rotation and vertical drop, symmetric around the center.
  rotate: number;
  drop: number;
}

export const AGENTS: AgentDef[] = [
  {
    id: "researcher",
    label: "Researcher",
    tagline: "Deep run across 4 scholarly indexes",
    placeholder: "Describe a research topic, question, or hypothesis...",
    icon: UserRound,
    accent: "#fca91e",
    rotate: -8,
    drop: 8,
  },
  {
    id: "article",
    label: "Article Writer",
    tagline: "Researches, then writes a full article",
    placeholder: "What should your article be about?",
    icon: PenLine,
    accent: "#ff7db1",
    rotate: -2.5,
    drop: 0,
  },
  {
    id: "review",
    label: "Literature Reviewer",
    tagline: "Thematic review with synthesis matrix",
    placeholder: "Describe the topic for a thematic literature review...",
    icon: BookOpenCheck,
    accent: "#50c158",
    rotate: 2.5,
    drop: 0,
  },
  {
    id: "assistant",
    label: "AI Assistant",
    tagline: "Cited answer from the best papers",
    placeholder: "Ask any research question...",
    icon: HatGlasses,
    accent: "#4f90e4",
    rotate: 8,
    drop: 8,
  },
];

export function agentDef(mode: AgentMode): AgentDef {
  return AGENTS.find((a) => a.id === mode) ?? AGENTS[0];
}

function AgentCard({
  agent,
  selected,
  disabled,
  fan,
  onSelect,
  onArrow,
}: {
  agent: AgentDef;
  selected: boolean;
  disabled?: boolean;
  /** true: arched wedge (desktop). false: compact grid tile (mobile). */
  fan: boolean;
  onSelect: () => void;
  onArrow: (dir: -1 | 1) => void;
}) {
  const Icon = agent.icon;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      data-agent={agent.id}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          onArrow(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          onArrow(-1);
        }
      }}
      style={
        {
          ...(fan
            ? { "--rot": `${agent.rotate}deg`, "--ty": `${agent.drop}px` }
            : {}),
          "--agent": agent.accent,
        } as React.CSSProperties
      }
      className={cn(
        "cursor-pointer border text-center transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-60",
        fan
          ? cn(
              "absolute inset-x-0 bottom-0 flex h-[140px] flex-col items-center justify-start rounded-t-[24px] rounded-b-xl px-3 pb-5 pt-4",
              "[transform-origin:50%_100%] [transform:rotate(var(--rot))_translateY(var(--ty))]",
              selected
                ? cn(
                    "z-10 border-[color-mix(in_oklab,var(--border)_60%,var(--muted-foreground))]",
                    "bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--card)_88%,white),color-mix(in_oklab,var(--card)_97%,white))]",
                    "dark:border-[color-mix(in_oklab,var(--agent)_35%,var(--border))]",
                    "dark:bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--agent)_20%,var(--card)),color-mix(in_oklab,var(--agent)_7%,var(--card)))]",
                    "shadow-[inset_0_0_26px_2px_color-mix(in_oklab,var(--agent)_30%,transparent),inset_0_1.5px_0_var(--classic-highlight),inset_0_-1px_0_var(--classic-shade),0_22px_44px_-18px_rgba(0,0,0,0.8)]",
                    "[transform:rotate(var(--rot))_translateY(calc(var(--ty)-12px))]"
                  )
                : cn(
                    "border-[color-mix(in_oklab,var(--border)_72%,var(--muted-foreground))]",
                    "bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--card)_84%,white)_0%,color-mix(in_oklab,var(--card)_95%,white)_100%)]",
                    "dark:border-[color-mix(in_oklab,var(--agent)_22%,var(--border))]",
                    "dark:bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--agent)_13%,var(--card)),color-mix(in_oklab,var(--agent)_4%,var(--card))_75%)]",
                    "shadow-[inset_0_1.5px_0_var(--classic-highlight),inset_0_-1px_0_var(--classic-shade),0_20px_40px_-18px_rgba(0,0,0,0.75)]",
                    "hover:brightness-[1.06] hover:[transform:rotate(var(--rot))_translateY(calc(var(--ty)-6px))]"
                  )
            )
          : cn(
              "flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left",
              "shadow-[inset_0_1px_0_var(--classic-highlight),inset_0_-1px_0_var(--classic-shade)]",
              selected
                ? "border-[color-mix(in_oklab,var(--border)_60%,var(--muted-foreground))] bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--card)_88%,white),color-mix(in_oklab,var(--card)_97%,white))] dark:border-[color-mix(in_oklab,var(--agent)_35%,var(--border))] dark:bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--agent)_20%,var(--card)),color-mix(in_oklab,var(--agent)_7%,var(--card)))] shadow-[inset_0_0_20px_2px_color-mix(in_oklab,var(--agent)_30%,transparent),inset_0_1px_0_var(--classic-highlight)]"
                : "border-[color-mix(in_oklab,var(--border)_72%,var(--muted-foreground))] bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--card)_84%,white)_0%,color-mix(in_oklab,var(--card)_95%,white)_100%)] dark:border-[color-mix(in_oklab,var(--agent)_22%,var(--border))] dark:bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--agent)_13%,var(--card)),color-mix(in_oklab,var(--agent)_4%,var(--card))_75%)] hover:brightness-[1.06]"
            )
      )}
    >
      {fan && selected && (
        <span className="absolute right-2.5 top-2.5 flex size-5 items-center justify-center rounded-full bg-[var(--agent)] text-white shadow">
          <Check className="size-3" />
        </span>
      )}
      {fan ? (
        // Counter-rotate the content so the text stays horizontal while
        // the wedge itself fans out.
        <span className="flex flex-col items-center gap-1.5 [transform:rotate(calc(var(--rot)*-1))]">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full transition-colors [&_svg]:size-[18px]",
              selected
                ? "bg-[color-mix(in_oklab,var(--agent)_30%,transparent)] text-[var(--agent)]"
                : "bg-[color-mix(in_oklab,var(--agent)_16%,transparent)] text-[var(--agent)]"
            )}
          >
            <Icon />
          </span>
          <span
            className={cn(
              "text-sm font-bold leading-tight tracking-tight",
              selected ? "text-foreground" : "text-foreground/85"
            )}
          >
            {agent.label}
          </span>
          <span className="line-clamp-2 px-1 text-[11px] leading-snug text-muted-foreground">
            {agent.tagline}
          </span>
        </span>
      ) : (
        <>
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors [&_svg]:size-4",
              selected
                ? "bg-[color-mix(in_oklab,var(--agent)_30%,transparent)] text-[var(--agent)]"
                : "bg-[color-mix(in_oklab,var(--agent)_16%,transparent)] text-[var(--agent)]"
            )}
          >
            <Icon />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {agent.label}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {agent.tagline}
            </span>
          </span>
        </>
      )}
    </button>
  );
}

/**
 * The Fiberarticle composer: a fan of agent wedges arched over a thick
 * chat input. Pick who works on the request, then describe it.
 */
export function AgentComposer({
  mode,
  onModeChange,
  value,
  onValueChange,
  onSubmit,
  isLoading = false,
  disabled = false,
  attachments = [],
  onAttach,
  onRemoveAttachment,
  footerRight,
  className,
}: {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  /** Files attached via the paperclip, shown as removable badges. */
  attachments?: File[];
  onAttach?: (files: File[]) => void;
  onRemoveAttachment?: (index: number) => void;
  /** Extra info rendered next to the submit button. */
  footerRight?: React.ReactNode;
  className?: string;
}) {
  const agent = agentDef(mode);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function moveSelection(from: AgentMode, dir: -1 | 1) {
    const index = AGENTS.findIndex((a) => a.id === from);
    const next = AGENTS[(index + dir + AGENTS.length) % AGENTS.length];
    onModeChange(next.id);
    // Keep focus on the radio that is now checked (roving tabindex).
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-agent="${next.id}"]`)
        ?.focus();
    });
  }

  const cards = (fan: boolean) =>
    AGENTS.map((a) => (
      <AgentCard
        key={a.id}
        agent={a}
        fan={fan}
        selected={mode === a.id}
        disabled={disabled || isLoading}
        onSelect={() => onModeChange(a.id)}
        onArrow={(dir) => moveSelection(a.id, dir)}
      />
    ));

  return (
    <div className={cn("flex w-full flex-col", className)}>
      {/* Desktop: the arched fan, tucked behind the input's top edge. */}
      <div
        role="radiogroup"
        aria-label="Choose an agent"
        className="relative -mb-3 hidden h-[150px] px-1 sm:block"
      >
        {AGENTS.map((a, i) => (
          <div
            key={a.id}
            className="absolute bottom-0 h-full"
            style={{ left: `calc(${i} * 25% + 3px)`, width: "calc(25% - 6px)" }}
          >
            <AgentCard
              agent={a}
              fan
              selected={mode === a.id}
              disabled={disabled || isLoading}
              onSelect={() => onModeChange(a.id)}
              onArrow={(dir) => moveSelection(a.id, dir)}
            />
          </div>
        ))}
      </div>

      {/* Mobile: compact 2x2 agent grid above the input. */}
      <div
        role="radiogroup"
        aria-label="Choose an agent"
        className="mb-2 grid grid-cols-2 gap-2 sm:hidden"
      >
        {cards(false)}
      </div>

      <div className="relative z-10">
        <PromptInput
          isLoading={isLoading}
          value={value}
          onValueChange={onValueChange}
          onSubmit={onSubmit}
          className="w-full rounded-[26px] border-2 border-[color-mix(in_oklab,var(--border)_78%,var(--muted-foreground))] bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--card)_88%,white),color-mix(in_oklab,var(--card)_97%,white)_50%)] shadow-[inset_0_1.5px_0_var(--classic-highlight),0_24px_60px_-26px_rgba(0,0,0,0.65)]"
        >
          <div className="flex flex-col">
            <PromptInputTextarea
              placeholder={agent.placeholder}
              aria-label={`Message for ${agent.label}`}
              disabled={disabled}
              className="min-h-24 px-5 pt-5"
            />
            {attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2 px-4">
                {attachments.map((file, index) => (
                  <AttachmentBadge
                    key={`${file.name}-${file.size}-${index}`}
                    file={file}
                    onRemove={() => onRemoveAttachment?.(index)}
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
                  accept={ACCEPTED_FILES}
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) onAttach?.(files);
                    e.target.value = "";
                  }}
                />
                <PromptInputAction tooltip="Attach files (PDF, Word, text, images)">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="rounded-full"
                    type="button"
                    aria-label="Attach files"
                    disabled={disabled || isLoading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip />
                  </Button>
                </PromptInputAction>
              </div>
              <div className="flex items-center gap-3">
                {footerRight}
                <Button
                  size="icon"
                  className="rounded-2xl"
                  disabled={!value.trim() || isLoading || disabled}
                  onClick={onSubmit}
                  aria-label={`Send to ${agent.label}`}
                >
                  {isLoading ? (
                    <span className="size-3 rounded-xs bg-primary-foreground" />
                  ) : (
                    <ArrowUp />
                  )}
                </Button>
              </div>
            </PromptInputActions>
          </div>
        </PromptInput>
      </div>
    </div>
  );
}
