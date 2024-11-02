"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Markdown } from "tiptap-markdown";
import {
  ArrowLeft,
  ArrowUp,
  Bold as BoldIcon,
  BookMarked,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Download,
  FileCode2,
  FoldVertical,
  GripVertical,
  Italic as ItalicIcon,
  Languages,
  List,
  ListOrdered,
  Minimize2,
  PenLine,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  UnfoldVertical,
  Undo2,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import {
  Source,
  SourceContent,
  SourceTrigger,
} from "@/components/prompt-kit/source";
import { StylePicker } from "@/components/style-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError, apiUrl, getApiToken } from "@/lib/api";
import type { DocumentDetail, DocumentTemplate } from "@/lib/types";
import { cn } from "@/lib/utils";

const templates: { value: DocumentTemplate; label: string }[] = [
  { value: "generic", label: "Generic manuscript" },
  { value: "ieee", label: "IEEE (IEEEtran)" },
  { value: "apa", label: "APA 7" },
  { value: "acm", label: "ACM (acmart)" },
  { value: "elsevier", label: "Elsevier (elsarticle)" },
  { value: "springer", label: "Springer Nature (sn-jnl)" },
  { value: "neurips", label: "NeurIPS" },
];

type AiPayload = {
  command:
    | "rewrite"
    | "expand"
    | "condense"
    | "improve"
    | "simplify"
    | "humanize"
    | "tone"
    | "translate"
    | "custom";
  instruction?: string;
  tone?: string;
  language?: string;
};

const quickActions: {
  payload: AiPayload;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { payload: { command: "improve" }, label: "Improve writing", icon: Wand2 },
  { payload: { command: "simplify" }, label: "Simplify", icon: Minimize2 },
  { payload: { command: "humanize" }, label: "Humanize", icon: UserRound },
  { payload: { command: "rewrite" }, label: "Rewrite for clarity", icon: PenLine },
  { payload: { command: "expand" }, label: "Expand", icon: UnfoldVertical },
  { payload: { command: "condense" }, label: "Condense", icon: FoldVertical },
];

const tones = [
  { value: "academic", label: "Academic" },
  { value: "formal", label: "Formal" },
  { value: "confident", label: "Confident" },
  { value: "friendly", label: "Friendly" },
  { value: "persuasive", label: "Persuasive" },
];

const translateLanguages = [
  { value: "en-US", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "ar", label: "Arabic" },
  { value: "ru", label: "Russian" },
];

/** The Fiberarticle mark in a white circle: the face of every AI control. */
function FiberAiIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-border",
        className
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/Fiberarticle_Logo_Without_Background.svg"
        alt="Fiberarticle AI"
        className="h-[64%] w-[64%]"
      />
    </span>
  );
}

type SelectionInfo = {
  text: string;
  before: string;
  after: string;
  from: number;
  to: number;
};

/** Citation markers like [5] must survive the markdown round-trip; the
 * serializer escapes brackets, which would corrupt them in exports. */
function cleanMarkdown(md: string): string {
  return md.replace(/\\([\[\]])/g, "$1");
}

/** tiptap-markdown exposes its serializer via editor storage, untyped. */
function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as {
    markdown: { getMarkdown: () => string };
  };
  return cleanMarkdown(storage.markdown.getMarkdown());
}

function SectionEditor({
  value,
  disabled,
  onChange,
  onReady,
  onFocusEditor,
  onSelection,
}: {
  value: string;
  disabled?: boolean;
  onChange: (markdown: string) => void;
  onReady: (editor: Editor | null) => void;
  onFocusEditor: (editor: Editor) => void;
  onSelection: (sel: SelectionInfo | null, point: { x: number; y: number }) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false }),
      Underline,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: value,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "fa-prose min-h-6 text-[15px] leading-7 outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      // A read-only editor (generation, AI busy) can still emit update
      // events from programmatic syncs; those are not user edits and must
      // not mark the document dirty.
      if (!editor.isEditable) return;
      onChange(getMarkdown(editor));
    },
    onFocus: ({ editor }) => onFocusEditor(editor),
    onSelectionUpdate: ({ editor }) => {
      const { empty } = editor.state.selection;
      let { from, to } = editor.state.selection;
      if (empty) {
        onSelection(null, { x: 0, y: 0 });
        return;
      }
      const doc = editor.state.doc;
      // Snap to word boundaries: a selection that cuts a word in half makes
      // the AI rewrite drift past the passage edge and mangle the splice.
      while (from > 0 && /\S/.test(doc.textBetween(from - 1, from, "\n"))) {
        from--;
      }
      while (
        to < doc.content.size &&
        /\S/.test(doc.textBetween(to, to + 1, "\n"))
      ) {
        to++;
      }
      const sel: SelectionInfo = {
        text: doc.textBetween(from, to, "\n"),
        before: doc.textBetween(Math.max(0, from - 160), from, "\n"),
        after: doc.textBetween(
          to,
          Math.min(doc.content.size, to + 160),
          "\n"
        ),
        from,
        to,
      };
      if (!sel.text.trim()) {
        onSelection(null, { x: 0, y: 0 });
        return;
      }
      const coords = editor.view.coordsAtPos(from);
      onSelection(sel, { x: coords.left, y: coords.top });
    },
  });

  React.useEffect(() => {
    onReady(editor ?? null);
    return () => onReady(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  React.useEffect(() => {
    // emitUpdate must stay false: setEditable fires an update event by
    // default, which would mark untouched documents dirty every time
    // generation or an AI edit toggles the disabled state.
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  // Apply external content changes (AI results, streamed sections) without
  // clobbering the user's caret during normal typing. emitUpdate must stay
  // false: a programmatic sync is not a user edit, and letting it emit marks
  // the document dirty (phantom "unsaved changes" on untouched documents).
  React.useEffect(() => {
    if (!editor) return;
    const current = getMarkdown(editor);
    if (value !== current) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  return <EditorContent editor={editor} />;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40 [&_svg]:size-4",
        active && "bg-accent text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/** Word-processor toolbar. Acts on whichever section editor has focus. */
function FormatToolbar({ editor }: { editor: Editor | null }) {
  // Re-render on every transaction so active states track the caret.
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    if (!editor) return;
    editor.on("transaction", force);
    return () => {
      editor.off("transaction", force);
    };
  }, [editor]);

  const can = (fn: () => boolean) => (editor ? fn() : false);

  return (
    <div className="sticky top-0 z-30 -mx-1 flex items-center gap-0.5 rounded-xl border border-border bg-card/95 px-1.5 py-1 shadow-sm backdrop-blur">
      <ToolbarButton
        title="Undo (Ctrl+Z)"
        disabled={!can(() => editor!.can().undo())}
        onClick={() => editor?.chain().focus().undo().run()}
      >
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton
        title="Redo (Ctrl+Y)"
        disabled={!can(() => editor!.can().redo())}
        onClick={() => editor?.chain().focus().redo().run()}
      >
        <Redo2 />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        title="Bold (Ctrl+B)"
        disabled={!editor}
        active={editor?.isActive("bold")}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <BoldIcon />
      </ToolbarButton>
      <ToolbarButton
        title="Italic (Ctrl+I)"
        disabled={!editor}
        active={editor?.isActive("italic")}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <ItalicIcon />
      </ToolbarButton>
      <ToolbarButton
        title="Underline (Ctrl+U)"
        disabled={!editor}
        active={editor?.isActive("underline")}
        onClick={() => editor?.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon />
      </ToolbarButton>
      <ToolbarButton
        title="Strikethrough"
        disabled={!editor}
        active={editor?.isActive("strike")}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton
        title="Inline code"
        disabled={!editor}
        active={editor?.isActive("code")}
        onClick={() => editor?.chain().focus().toggleCode().run()}
      >
        <Code />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        title="Bullet list"
        disabled={!editor}
        active={editor?.isActive("bulletList")}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        title="Numbered list"
        disabled={!editor}
        active={editor?.isActive("orderedList")}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        title="Quote"
        disabled={!editor}
        active={editor?.isActive("blockquote")}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </ToolbarButton>
      {!editor && (
        <span className="ml-2 text-xs text-muted-foreground">
          Click into a section to format text
        </span>
      )}
    </div>
  );
}

function TitleTextarea({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      className="w-full resize-none overflow-hidden border-none bg-transparent text-3xl font-semibold leading-tight tracking-tight outline-none disabled:opacity-70"
      placeholder="Article title"
    />
  );
}

/** Inline AI edit bar, Paperguide style: a free-form instruction input plus
 * quick actions with expandable tone and translate option rows. */
function AiBar({
  selectionPreview,
  onRun,
  onClose,
}: {
  selectionPreview: string | null;
  onRun: (payload: AiPayload) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = React.useState("");
  const [expanded, setExpanded] = React.useState<"tone" | "translate" | null>(
    null
  );

  return (
    <div
      className="my-2 rounded-2xl border border-border bg-popover p-2 shadow-[0_12px_40px_rgba(0,0,0,0.14)]"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      {selectionPreview && (
        <div className="mb-2 line-clamp-2 rounded-lg bg-accent px-3 py-1.5 text-xs text-muted-foreground">
          Editing selection: &ldquo;{selectionPreview}&rdquo;
        </div>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!prompt.trim()) return;
          onRun({ command: "custom", instruction: prompt.trim() });
        }}
      >
        <FiberAiIcon className="ml-1 size-6" />
        <input
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe how you want to edit or rewrite this text..."
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="sm" disabled={!prompt.trim()}>
          <ArrowUp />
        </Button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI bar"
          className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </form>
      <div className="mt-1.5 flex flex-col border-t border-border pt-1.5">
        <div className="flex flex-wrap gap-0.5">
          {quickActions.map(({ payload, label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => onRun(payload)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <Icon className="size-4 text-muted-foreground" />
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setExpanded(expanded === "tone" ? null : "tone")}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-accent",
              expanded === "tone" && "bg-accent"
            )}
          >
            <PenLine className="size-4 text-muted-foreground" />
            Change tone
            <ChevronRight
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                expanded === "tone" && "rotate-90"
              )}
            />
          </button>
          <button
            type="button"
            onClick={() =>
              setExpanded(expanded === "translate" ? null : "translate")
            }
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-accent",
              expanded === "translate" && "bg-accent"
            )}
          >
            <Languages className="size-4 text-muted-foreground" />
            Translate
            <ChevronRight
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                expanded === "translate" && "rotate-90"
              )}
            />
          </button>
        </div>
        {expanded === "tone" && (
          <div className="mt-1 flex flex-wrap gap-1.5 px-1 pb-1">
            {tones.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => onRun({ command: "tone", tone: t.value })}
                className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-accent"
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {expanded === "translate" && (
          <div className="mt-1 flex flex-wrap gap-1.5 px-1 pb-1">
            {translateLanguages.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => onRun({ command: "translate", language: l.value })}
                className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-accent"
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function DocumentEditor({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [doc, setDoc] = React.useState<DocumentDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [exportingLatex, setExportingLatex] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState<string | null>(null);
  // The inline AI bar: which section it is open on, and (optionally) the
  // selected passage it should edit instead of the whole section.
  const [aiBar, setAiBar] = React.useState<{
    sectionId: string;
    selection: SelectionInfo | null;
  } | null>(null);
  // Floating "Ask AI" pill shown next to a fresh text selection.
  const [pill, setPill] = React.useState<{
    sectionId: string;
    selection: SelectionInfo;
    x: number;
    y: number;
  } | null>(null);
  // One-level undo for the last applied whole-section AI edit. Selection
  // edits ride the editor's own history (Ctrl+Z).
  const [lastEdit, setLastEdit] = React.useState<{
    sectionId: string;
    heading: string;
    prev: string;
  } | null>(null);
  // The section editor that currently has focus drives the format toolbar.
  const [activeEditor, setActiveEditor] = React.useState<Editor | null>(null);
  const editorsRef = React.useRef<Record<string, Editor | null>>({});

  const load = React.useCallback(async () => {
    try {
      const data = await apiFetch<DocumentDetail>(`/v1/documents/${documentId}`);
      setDoc((prev) => {
        // Never clobber local unsaved edits with poll results.
        if (prev && dirty) return prev;
        return data;
      });
      return data;
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not load this document."
      );
      return null;
    }
  }, [documentId, dirty]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Poll while generating so sections stream in as they are written.
  React.useEffect(() => {
    if (doc?.status !== "generating") return;
    const interval = setInterval(load, 2500);
    return () => clearInterval(interval);
  }, [doc?.status, load]);

  // Real elapsed time while generating: free-tier model calls can take
  // minutes, and a static label reads as stuck.
  const [genElapsed, setGenElapsed] = React.useState("");
  React.useEffect(() => {
    if (doc?.status !== "generating") return;
    const start = new Date(doc.created_at).getTime();
    const update = () => {
      const total = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const minutes = Math.floor(total / 60);
      setGenElapsed(minutes > 0 ? `${minutes}m ${total % 60}s` : `${total}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [doc?.status, doc?.created_at]);

  // Autosave: persist quietly shortly after the last change so edits are
  // never lost to navigation. The Save button remains as an instant flush.
  React.useEffect(() => {
    if (!dirty || !doc || doc.status === "generating" || saving || aiBusy) {
      return;
    }
    const timer = setTimeout(() => {
      onSave();
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, dirty, saving, aiBusy]);

  // Belt and suspenders: warn on tab close or reload while a save is
  // still pending.
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // The selection pill is positioned in viewport coordinates; scrolling
  // would leave it floating over the wrong text.
  React.useEffect(() => {
    if (!pill) return;
    const hide = () => setPill(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [pill]);

  function mutate(updater: (d: DocumentDetail) => DocumentDetail) {
    setDoc((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
    setSaved(false);
  }

  async function onSave() {
    if (!doc) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<DocumentDetail>(
        `/v1/documents/${doc.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            title: doc.title,
            template: doc.template,
            sections: doc.sections,
            authors: doc.authors,
            citation_style: doc.citation_style,
          }),
        }
      );
      setDoc((prev) => {
        // Keep local section text: the editors own it while the page is
        // open, and the server echo may lag a keystroke behind.
        if (!prev) return updated;
        return { ...updated, sections: prev.sections, title: prev.title };
      });
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadExport(
    path: string,
    fallbackName: string,
    doneNotice: string,
    setBusy: (v: boolean) => void
  ) {
    if (!doc) return;
    if (dirty) await onSave();
    setBusy(true);
    setError(null);
    try {
      const token = await getApiToken();
      const res = await fetch(apiUrl(path), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new ApiError(res.status, "Export failed. Is the document ready?");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+?)"/);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = match?.[1] ?? fallbackName;
      a.click();
      URL.revokeObjectURL(a.href);
      setNotice(doneNotice);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  function onExport() {
    if (!doc) return;
    return downloadExport(
      `/v1/documents/${doc.id}/export`,
      "article.docx",
      "Exported .docx downloaded.",
      setExporting
    );
  }

  function onExportLatex() {
    if (!doc) return;
    return downloadExport(
      `/v1/documents/${doc.id}/export-latex`,
      "article-latex.zip",
      "LaTeX project downloaded. Upload the zip to Overleaf to compile.",
      setExportingLatex
    );
  }

  async function runAi(
    sectionId: string,
    payload: AiPayload,
    selection: SelectionInfo | null
  ) {
    if (!doc) return;
    const section = doc.sections.find((s) => s.id === sectionId);
    if (!section) return;
    if (dirty) await onSave();
    setAiBar(null);
    setPill(null);
    setAiBusy(sectionId);
    setError(null);
    setNotice(null);
    const prev = section.content;
    try {
      const result = await apiFetch<{ section_id: string; content: string }>(
        `/v1/documents/${doc.id}/edit`,
        {
          method: "POST",
          body: JSON.stringify({
            section_id: sectionId,
            ...payload,
            ...(selection && {
              selected_text: selection.text,
              context_before: selection.before,
              context_after: selection.after,
            }),
          }),
        }
      );
      if (selection) {
        // Splice the revised passage into the live editor; its own history
        // makes this undoable with Ctrl+Z, and autosave persists it.
        const editor = editorsRef.current[sectionId];
        if (editor) {
          editor
            .chain()
            .focus()
            .insertContentAt(
              { from: selection.from, to: selection.to },
              result.content
            )
            .run();
        }
        setLastEdit(null);
      } else {
        setDoc((d) =>
          d
            ? {
                ...d,
                sections: d.sections.map((s) =>
                  s.id === result.section_id
                    ? { ...s, content: result.content }
                    : s
                ),
              }
            : d
        );
        setLastEdit({ sectionId, heading: section.heading, prev });
        setDirty(false);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The AI edit failed.");
    } finally {
      setAiBusy(null);
    }
  }

  function undoLastEdit() {
    if (!lastEdit) return;
    setError(null);
    setNotice(null);
    mutate((d) => ({
      ...d,
      sections: d.sections.map((s) =>
        s.id === lastEdit.sectionId ? { ...s, content: lastEdit.prev } : s
      ),
    }));
    setLastEdit(null);
  }

  function insertSection(afterIndex: number) {
    const id = crypto.randomUUID();
    mutate((d) => {
      const sections = [...d.sections];
      sections.splice(afterIndex + 1, 0, {
        id,
        heading: "New section",
        content: "",
      });
      return { ...d, sections };
    });
    // Bring the new block into view and put the caret in its heading,
    // ready to be renamed.
    requestAnimationFrame(() => {
      const heading = document.getElementById(
        `sec-heading-${id}`
      ) as HTMLInputElement | null;
      heading?.scrollIntoView({ behavior: "smooth", block: "center" });
      heading?.focus();
      heading?.select();
    });
  }

  function moveSection(index: number, dir: -1 | 1) {
    mutate((d) => {
      const target = index + dir;
      if (target < 0 || target >= d.sections.length) return d;
      const sections = [...d.sections];
      const [s] = sections.splice(index, 1);
      sections.splice(target, 0, s);
      return { ...d, sections };
    });
  }

  function deleteSection(id: string) {
    if (!doc || doc.sections.length <= 1) return;
    // Autosaved shortly after, but still reversible from the Articles list
    // history is not kept, so keep it lightweight: no dialog.
    mutate((d) => ({
      ...d,
      sections: d.sections.filter((s) => s.id !== id),
    }));
    setNotice("Section removed.");
  }

  const [stopping, setStopping] = React.useState(false);

  async function onStopGeneration() {
    setStopping(true);
    setError(null);
    try {
      // Non-destructive: sections written so far are kept and editable.
      const updated = await apiFetch<DocumentDetail>(
        `/v1/documents/${documentId}/cancel`,
        { method: "POST" }
      );
      setDoc(updated);
      setNotice("Generation stopped. The sections written so far are kept.");
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not stop the generation."
      );
    } finally {
      setStopping(false);
    }
  }

  async function onDelete() {
    if (!doc) return;
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    await apiFetch(`/v1/documents/${doc.id}`, { method: "DELETE" });
    router.push("/documents");
  }

  function jumpToSection(id: string) {
    document
      .getElementById(`sec-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (error && !doc) {
    return (
      <div className="mx-auto max-w-3xl">
        <Callout tone="error">{error}</Callout>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const generating = doc.status === "generating";
  const totalWords = doc.sections.reduce(
    (n, s) => n + s.content.split(/\s+/).filter(Boolean).length,
    0
  );

  return (
    <div className="mx-auto flex max-w-5xl gap-8 pb-24">
      {/* Sticky contents rail: jump anywhere without endless scrolling. */}
      <nav className="sticky top-8 hidden w-48 shrink-0 self-start xl:block">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Contents
        </p>
        <div className="flex flex-col gap-0.5">
          {doc.sections.map((section, i) => (
            <button
              key={section.id}
              type="button"
              onClick={() => jumpToSection(section.id)}
              className="cursor-pointer truncate rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {i + 1}. {section.heading}
            </button>
          ))}
          {doc.references.length > 0 && (
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById("doc-references")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="cursor-pointer truncate rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              References ({doc.references.length})
            </button>
          )}
        </div>
      </nav>

      <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Link href="/documents">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-muted-foreground"
            >
              <ArrowLeft /> Articles
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            {generating ? (
              <>
                <TextShimmer className="text-xs">
                  {`Writing section ${Math.min(
                    doc.sections.length + 1,
                    doc.total_sections
                  )} of ${doc.total_sections}`}
                </TextShimmer>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {genElapsed}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  loading={stopping}
                  onClick={onStopGeneration}
                >
                  <X /> Stop
                </Button>
              </>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">
                  {totalWords.toLocaleString()} words
                </span>
                {saved && !dirty && (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Check className="size-3.5" /> Saved
                  </span>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onSave}
                  loading={saving}
                  disabled={!dirty}
                >
                  Save
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onExportLatex}
                  loading={exportingLatex}
                >
                  <FileCode2 /> Export LaTeX
                </Button>
                <Button size="sm" onClick={onExport} loading={exporting}>
                  <Download /> Export .docx
                </Button>
              </>
            )}
          </div>
        </div>

        {generating && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[linear-gradient(to_right,var(--classic-accent-from),var(--classic-accent-to))] transition-[width] duration-700"
              style={{
                width: `${Math.round(
                  (doc.sections.length / Math.max(doc.total_sections, 1)) * 100
                )}%`,
              }}
            />
          </div>
        )}

        {!generating && <FormatToolbar editor={activeEditor} />}

        {error && <Callout tone="error">{error}</Callout>}
        {notice && <Callout tone="success">{notice}</Callout>}
        {doc.status === "failed" && (
          <Callout tone="error">
            Generation failed: {doc.error ?? "unknown error"}
          </Callout>
        )}
        {lastEdit && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2 text-sm">
            <span className="min-w-0 truncate text-muted-foreground">
              AI edit applied to {lastEdit.heading}.
            </span>
            <Button variant="ghost" size="sm" onClick={undoLastEdit}>
              <Undo2 /> Undo
            </Button>
          </div>
        )}

        {/* The page: one continuous document, edited in place. */}
        <div className="rounded-2xl border border-border bg-card px-6 py-8 sm:px-14 sm:py-12">
          <TitleTextarea
            value={doc.title}
            disabled={generating}
            onChange={(v) => mutate((d) => ({ ...d, title: v }))}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Input
              value={doc.authors.join(", ")}
              disabled={generating}
              onChange={(e) =>
                mutate((d) => ({
                  ...d,
                  authors: e.target.value
                    .split(",")
                    .map((a) => a.trim())
                    .filter(Boolean),
                }))
              }
              placeholder="Authors (comma separated)"
              className="max-w-xs"
            />
            <select
              value={doc.template}
              disabled={generating}
              onChange={(e) =>
                mutate((d) => ({
                  ...d,
                  template: e.target.value as DocumentTemplate,
                }))
              }
              className="h-9 cursor-pointer rounded-xl border border-input bg-transparent px-3 text-sm focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1"
            >
              {templates.map((t) => (
                <option
                  key={t.value}
                  value={t.value}
                  className="bg-popover text-popover-foreground"
                >
                  {t.label}
                </option>
              ))}
            </select>
            {/* Per-document citation style; falls back to the global
                preference from Settings when unset. */}
            <StylePicker
              value={doc.citation_style ?? ""}
              onSelect={(style) =>
                mutate((d) => ({ ...d, citation_style: style.id }))
              }
            >
              <Button
                variant="outline"
                size="sm"
                disabled={generating}
                className="max-w-56"
              >
                <BookMarked />
                <span className="truncate">
                  {doc.citation_style ?? "Citation style: default"}
                </span>
              </Button>
            </StylePicker>
            <Badge>{doc.references.length} references</Badge>
          </div>

          <div className="my-7 h-px bg-border" />

          <div className="flex flex-col gap-6">
            {doc.sections.map((section, index) => (
              <div
                key={section.id}
                id={`sec-${section.id}`}
                className="group relative scroll-mt-8"
              >
                {/* Hover gutter: add block, move or delete, ask AI. */}
                {!generating && (
                  <div className="absolute -left-11 top-1 hidden flex-col items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 sm:flex">
                    <button
                      type="button"
                      title="Add a section below"
                      onClick={() => insertSection(index)}
                      className="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="size-4" />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          title="Section options"
                          className="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <GripVertical className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="right">
                        <DropdownMenuItem
                          disabled={index === 0}
                          onSelect={() => moveSection(index, -1)}
                        >
                          <ArrowUp /> Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={index === doc.sections.length - 1}
                          onSelect={() => moveSection(index, 1)}
                        >
                          <ChevronDown /> Move down
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={doc.sections.length <= 1}
                          onSelect={() => deleteSection(section.id)}
                          className="text-destructive"
                        >
                          <Trash2 /> Delete section
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <button
                      type="button"
                      title="Edit with AI"
                      disabled={aiBusy !== null}
                      onClick={() =>
                        setAiBar(
                          aiBar?.sectionId === section.id && !aiBar.selection
                            ? null
                            : { sectionId: section.id, selection: null }
                        )
                      }
                      className="cursor-pointer rounded-full transition-transform hover:scale-110 disabled:opacity-50"
                    >
                      <FiberAiIcon className="size-6" />
                    </button>
                  </div>
                )}

                <input
                  id={`sec-heading-${section.id}`}
                  value={section.heading}
                  disabled={generating}
                  onChange={(e) =>
                    mutate((d) => ({
                      ...d,
                      sections: d.sections.map((s) =>
                        s.id === section.id
                          ? { ...s, heading: e.target.value }
                          : s
                      ),
                    }))
                  }
                  className="w-full border-none bg-transparent text-xl font-semibold tracking-tight outline-none disabled:opacity-70"
                />

                {aiBar?.sectionId === section.id && aiBusy !== section.id && (
                  <AiBar
                    selectionPreview={
                      aiBar.selection
                        ? aiBar.selection.text.slice(0, 160)
                        : null
                    }
                    onRun={(payload) =>
                      runAi(section.id, payload, aiBar.selection)
                    }
                    onClose={() => setAiBar(null)}
                  />
                )}

                {aiBusy === section.id && (
                  <TextShimmer className="mt-1 text-sm">
                    Fiberarticle AI is rewriting this text
                  </TextShimmer>
                )}

                <SectionEditor
                  value={section.content}
                  disabled={generating || aiBusy === section.id}
                  onChange={(markdown) =>
                    mutate((d) => ({
                      ...d,
                      sections: d.sections.map((s) =>
                        s.id === section.id ? { ...s, content: markdown } : s
                      ),
                    }))
                  }
                  onReady={(editor) => {
                    editorsRef.current[section.id] = editor;
                  }}
                  onFocusEditor={setActiveEditor}
                  onSelection={(sel, point) => {
                    if (sel && sel.text.trim()) {
                      setPill({
                        sectionId: section.id,
                        selection: sel,
                        x: Math.min(
                          Math.max(point.x, 60),
                          window.innerWidth - 80
                        ),
                        y: Math.max(point.y - 44, 12),
                      });
                    } else {
                      setPill((p) => (p?.sectionId === section.id ? null : p));
                    }
                  }}
                />
              </div>
            ))}
          </div>

          {generating && (
            <div className="mt-6 flex flex-col gap-3">
              <TextShimmer className="text-sm">
                Writing the next section
              </TextShimmer>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}

          {!generating && (
            <button
              type="button"
              onClick={() => insertSection(doc.sections.length - 1)}
              className="mt-6 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-4" /> Add section
            </button>
          )}

          {doc.references.length > 0 && (
            <div id="doc-references" className="mt-10 scroll-mt-8">
              <h2 className="mb-2.5 text-sm font-semibold text-muted-foreground">
                References ({doc.references.length})
              </h2>
              <div className="flex flex-wrap gap-2">
                {doc.references.map((paper, i) => (
                  <Source key={paper.id} href={paper.url ?? undefined}>
                    <SourceTrigger label={`[${i + 1}] ${paper.title}`} />
                    <SourceContent
                      title={paper.title}
                      description={[
                        paper.authors.slice(0, 4).join(", ") +
                          (paper.authors.length > 4 ? " et al." : ""),
                        paper.year ? `(${paper.year})` : null,
                        paper.venue,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  </Source>
                ))}
              </div>
            </div>
          )}
        </div>

        {!generating && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={onDelete}
            >
              <Trash2 /> Delete article
            </Button>
          </div>
        )}
      </div>

      {/* Floating "Ask AI" pill over a fresh selection. */}
      {pill && !aiBusy && (
        <div
          className="fixed z-50 -translate-x-1/2"
          style={{ left: pill.x, top: pill.y }}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setAiBar({
                sectionId: pill.sectionId,
                selection: pill.selection,
              });
              setPill(null);
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-popover py-1 pl-1 pr-3 text-sm shadow-lg transition-colors hover:bg-accent"
          >
            <FiberAiIcon className="size-6" /> Ask AI
          </button>
        </div>
      )}
    </div>
  );
}
