"use client";

import * as React from "react";
import {
  ArrowUp,
  BookOpen,
  BookOpenCheck,
  Check,
  HatGlasses,
  PenLine,
  Search,
  Settings2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/prompt-kit/prompt-input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  footerLeft,
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
  /** Extra chips rendered on the left of the action row. */
  footerLeft?: React.ReactNode;
  /** Extra info rendered next to the submit button. */
  footerRight?: React.ReactNode;
  className?: string;
}) {
  const agent = agentDef(mode);

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
            <PromptInputActions className="mt-3 w-full justify-between px-3 pb-3">
              <div className="flex items-center gap-2">
                {footerLeft ?? (
                  <>
                    <PromptInputAction tooltip="Searches arXiv, OpenAlex, Semantic Scholar, and Crossref">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        type="button"
                      >
                        <Search />
                        4 scholarly indexes
                      </Button>
                    </PromptInputAction>
                    <PromptInputAction tooltip="Open-access papers are read in full; paywalled ones abstract-only">
                      <Button
                        variant="outline"
                        size="sm"
                        className="hidden rounded-full md:inline-flex"
                        type="button"
                      >
                        <BookOpen />
                        Open access
                      </Button>
                    </PromptInputAction>
                    <PromptInputAction tooltip="LLM settings">
                      <Link href="/settings">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="rounded-full"
                          type="button"
                          aria-label="LLM settings"
                        >
                          <Settings2 />
                        </Button>
                      </Link>
                    </PromptInputAction>
                  </>
                )}
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
