"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import {
  Table as TableExtension,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { Image as ImageExtension } from "@tiptap/extension-image";
import { TextAlign } from "@tiptap/extension-text-align";
import { FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Markdown } from "tiptap-markdown";
import { PaginationPlus } from "tiptap-pagination-plus";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowUp,
  Bold as BoldIcon,
  BookMarked,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Columns2,
  Download,
  Eye,
  FoldVertical,
  Heading2,
  Heading3,
  ImagePlus,
  Italic as ItalicIcon,
  Languages,
  List,
  ListOrdered,
  Minimize2,
  Paperclip,
  PenLine,
  Plus,
  Quote,
  Redo2,
  SeparatorHorizontal,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  UnfoldVertical,
  Undo2,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import { AttachmentBadge } from "@/components/agent-composer";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { StylePicker } from "@/components/style-picker";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError, apiUrl, getApiToken } from "@/lib/api";
import type {
  Bibliography,
  DocumentChatResult,
  DocumentChatTurn,
  DocumentDetail,
  DocumentSection,
  DocumentTemplate,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  MdHeading,
  MdParagraph,
  SectionNumbering,
  TitleBlock,
  type FaDocMeta,
} from "./doc-extensions";

const templates: { value: DocumentTemplate; label: string }[] = [
  { value: "generic", label: "Generic manuscript" },
  { value: "ieee", label: "IEEE (IEEEtran)" },
  { value: "apa", label: "APA 7" },
  { value: "acm", label: "ACM (acmart)" },
  { value: "elsevier", label: "Elsevier (elsarticle)" },
  { value: "springer", label: "Springer Nature (sn-jnl)" },
  { value: "neurips", label: "NeurIPS" },
];

/* ------------------------------------------------------------------
   WYSIWYG page styling. Mirrors the .docx/PDF layout families exactly
   (fonts, sizes, spacing, indents, heading treatment), so the pages on
   screen are what the export produces. */

type PageLayout = "generic" | "ieee" | "apa";

const LAYOUT_FOR_TEMPLATE: Record<DocumentTemplate, PageLayout> = {
  generic: "generic",
  ieee: "ieee",
  apa: "apa",
  acm: "ieee",
  elsevier: "generic",
  springer: "generic",
  neurips: "generic",
};

const PAGE_STYLES: Record<
  PageLayout,
  {
    font: string;
    bodyPt: number;
    titlePt: number;
    headingPt: number;
    leading: number;
    indentIn: number;
    spaceEm: number;
    numbered: boolean;
    upper: boolean;
    twoColumnOnExport: boolean;
  }
> = {
  generic: {
    font: 'Calibri, "Segoe UI", sans-serif',
    bodyPt: 11,
    titlePt: 18,
    headingPt: 13,
    leading: 1.4,
    indentIn: 0,
    spaceEm: 0.55,
    numbered: true,
    upper: false,
    twoColumnOnExport: false,
  },
  ieee: {
    font: '"Times New Roman", Times, serif',
    bodyPt: 10,
    titlePt: 24,
    headingPt: 10,
    leading: 1.35,
    indentIn: 0.17,
    spaceEm: 0.4,
    numbered: true,
    upper: true,
    twoColumnOnExport: true,
  },
  apa: {
    font: '"Times New Roman", Times, serif',
    bodyPt: 12,
    titlePt: 12,
    headingPt: 12,
    leading: 2,
    indentIn: 0.5,
    spaceEm: 0,
    numbered: false,
    upper: false,
    twoColumnOnExport: false,
  },
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function pageVars(layout: PageLayout): React.CSSProperties {
  const s = PAGE_STYLES[layout];
  return {
    "--pg-font": s.font,
    "--pg-body": `${s.bodyPt}pt`,
    "--pg-title": `${s.titlePt}pt`,
    "--pg-heading": `${s.headingPt}pt`,
    "--pg-leading": String(s.leading),
    "--pg-indent": s.indentIn ? `${s.indentIn}in` : "0",
    "--pg-space": `${s.spaceEm}em`,
  } as React.CSSProperties;
}

function isAbstract(heading: string): boolean {
  return heading.trim().toLowerCase() === "abstract";
}

/** Word-style heading number prefixes ("1. " / "I. "), skipping Abstract. */
function headingPrefixes(
  sections: { heading: string }[],
  layout: PageLayout
): string[] {
  const style = PAGE_STYLES[layout];
  let counter = 0;
  return sections.map((section) => {
    if (!style.numbered || isAbstract(section.heading)) return "";
    counter += 1;
    return style.upper
      ? `${ROMAN[Math.min(counter - 1, ROMAN.length - 1)]}. `
      : `${counter}. `;
  });
}

/* ------------------------------------------------------------------
   Single-document <-> sections[] mapping. The editor holds the whole
   article as one flow (level-2 headings delimit sections); storage and
   every API stay section-based. */

function buildBody(sections: DocumentSection[]): string {
  return sections
    .map((s) => `## ${s.heading || "Section"}\n\n${s.content}`.trim())
    .join("\n\n");
}

const SECTION_HEADING_RE = /^##(?!#)\s+(.*)$/;

function splitSections(
  markdown: string,
  prev: DocumentSection[]
): DocumentSection[] {
  const drafts: { heading: string; body: string[] }[] = [];
  const preamble: string[] = [];
  for (const line of markdown.split("\n")) {
    const m = SECTION_HEADING_RE.exec(line);
    if (m) {
      drafts.push({ heading: m[1].trim() || "Section", body: [] });
    } else {
      (drafts.length ? drafts[drafts.length - 1].body : preamble).push(line);
    }
  }
  if (drafts.length === 0) {
    return [
      {
        id: prev[0]?.id ?? crypto.randomUUID(),
        heading: prev[0]?.heading ?? "Untitled section",
        content: markdown.trim(),
      },
    ];
  }
  // Stray text above the first heading (its heading was deleted): keep it.
  if (preamble.join("").trim()) {
    drafts[0].body = [...preamble, ...drafts[0].body];
  }
  const used = new Set<string>();
  return drafts.map((draft, i) => {
    let id: string | undefined;
    if (prev.length === drafts.length && prev[i]) {
      id = prev[i].id;
    } else {
      id = prev.find((p) => !used.has(p.id) && p.heading === draft.heading)?.id;
    }
    if (!id || used.has(id)) id = crypto.randomUUID();
    used.add(id);
    return { id, heading: draft.heading, content: draft.body.join("\n").trim() };
  });
}

/** Index of the section (level-2 heading) that contains doc position pos. */
function sectionIndexAtPos(editor: Editor, pos: number): number {
  let index = -1;
  let found = 0;
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "heading" && node.attrs.level === 2) {
      index += 1;
      if (offset <= pos) found = index;
    }
  });
  return Math.max(found, 0);
}

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

/** The Fiberarticle mark in a circle: the face of every AI control. The
 * circle follows the theme so it never glares in dark mode. */
function FiberAiIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-border dark:bg-[#2b2b30]",
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

/** Downscale an image to at most 1600px and return it as a data URI, so
 * embedded figures stay reasonably small inside the stored document. */
async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  // PNG keeps diagrams/transparency crisp; photos compress as JPEG.
  const isPng = file.type === "image/png";
  return canvas.toDataURL(isPng ? "image/png" : "image/jpeg", 0.85);
}

/** tiptap-markdown exposes its serializer via editor storage, untyped. */
function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as {
    markdown: { getMarkdown: () => string };
  };
  return cleanMarkdown(storage.markdown.getMarkdown());
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

/** Word-style font family and size lists. "Default" clears the mark so the
 * text follows the journal template again. */
const FONT_FAMILIES = [
  "Times New Roman",
  "Calibri",
  "Arial",
  "Georgia",
  "Garamond",
  "Cambria",
  "Courier New",
];
const FONT_SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24"];

/** Word-processor toolbar for the document editor. */
function FormatToolbar({
  editor,
  onAskAi,
}: {
  editor: Editor | null;
  onAskAi: () => void;
}) {
  // Re-render on every transaction so active states track the caret.
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    if (!editor) return;
    editor.on("transaction", force);
    return () => {
      editor.off("transaction", force);
    };
  }, [editor]);

  const imageInputRef = React.useRef<HTMLInputElement>(null);

  async function insertImage(file: File) {
    if (!editor) return;
    try {
      const src = await fileToDataUrl(file);
      const alt = file.name.replace(/\.[^.]+$/, "");
      editor.chain().focus().setImage({ src, alt }).run();
    } catch {
      // Unreadable image: ignore rather than crash the toolbar.
    }
  }

  const ready = editor?.isEditable ?? false;
  const can = (fn: () => boolean) => (ready ? fn() : false);
  const inTable = (ready && editor?.isActive("table")) ?? false;
  const textStyle = (ready && editor?.getAttributes("textStyle")) || {};
  const activeFamily =
    typeof textStyle.fontFamily === "string" ? textStyle.fontFamily : "default";
  const activeSize =
    typeof textStyle.fontSize === "string"
      ? textStyle.fontSize.replace("pt", "")
      : "default";

  return (
    <div className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center gap-0.5 rounded-xl border border-border bg-card/95 px-1.5 py-1 shadow-sm backdrop-blur">
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
      <Select.Root
        value={activeFamily}
        disabled={!ready}
        onValueChange={(value) => {
          if (value === "default") {
            editor?.chain().focus().unsetFontFamily().run();
          } else {
            editor?.chain().focus().setFontFamily(value).run();
          }
        }}
      >
        <Select.Trigger
          className="h-8 w-36 rounded-lg border-transparent text-xs shadow-none hover:bg-accent"
          title="Font"
        >
          <Select.Value placeholder="Font" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="default">Template font</Select.Item>
          {FONT_FAMILIES.map((family) => (
            <Select.Item key={family} value={family}>
              <span style={{ fontFamily: family }}>{family}</span>
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <Select.Root
        value={activeSize}
        disabled={!ready}
        onValueChange={(value) => {
          if (value === "default") {
            editor?.chain().focus().unsetFontSize().run();
          } else {
            editor?.chain().focus().setFontSize(`${value}pt`).run();
          }
        }}
      >
        <Select.Trigger
          className="h-8 w-[4.75rem] rounded-lg border-transparent text-xs shadow-none hover:bg-accent"
          title="Font size"
        >
          <Select.Value placeholder="Size" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="default">Auto</Select.Item>
          {FONT_SIZES.map((size) => (
            <Select.Item key={size} value={size}>
              {size} pt
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        title="Bold (Ctrl+B)"
        disabled={!ready}
        active={ready && editor?.isActive("bold")}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <BoldIcon />
      </ToolbarButton>
      <ToolbarButton
        title="Italic (Ctrl+I)"
        disabled={!ready}
        active={ready && editor?.isActive("italic")}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <ItalicIcon />
      </ToolbarButton>
      <ToolbarButton
        title="Underline (Ctrl+U)"
        disabled={!ready}
        active={ready && editor?.isActive("underline")}
        onClick={() => editor?.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon />
      </ToolbarButton>
      <ToolbarButton
        title="Strikethrough"
        disabled={!ready}
        active={ready && editor?.isActive("strike")}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton
        title="Superscript"
        disabled={!ready}
        active={ready && editor?.isActive("superscript")}
        onClick={() => editor?.chain().focus().toggleSuperscript().run()}
      >
        <SuperscriptIcon />
      </ToolbarButton>
      <ToolbarButton
        title="Subscript"
        disabled={!ready}
        active={ready && editor?.isActive("subscript")}
        onClick={() => editor?.chain().focus().toggleSubscript().run()}
      >
        <SubscriptIcon />
      </ToolbarButton>
      <ToolbarButton
        title="Inline code"
        disabled={!ready}
        active={ready && editor?.isActive("code")}
        onClick={() => editor?.chain().focus().toggleCode().run()}
      >
        <Code />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-border" />
      {(
        [
          { value: "left", title: "Align left", icon: AlignLeft },
          { value: "center", title: "Align center", icon: AlignCenter },
          { value: "right", title: "Align right", icon: AlignRight },
          { value: "justify", title: "Justify", icon: AlignJustify },
        ] as const
      ).map(({ value, title, icon: Icon }) => (
        <ToolbarButton
          key={value}
          title={title}
          disabled={!ready}
          active={ready && editor?.isActive({ textAlign: value })}
          onClick={() => {
            if (editor?.isActive({ textAlign: value })) {
              editor.chain().focus().unsetTextAlign().run();
            } else {
              editor?.chain().focus().setTextAlign(value).run();
            }
          }}
        >
          <Icon />
        </ToolbarButton>
      ))}
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        title="Section heading"
        disabled={!ready}
        active={ready && editor?.isActive("heading", { level: 2 })}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton
        title="Subheading"
        disabled={!ready}
        active={ready && editor?.isActive("heading", { level: 3 })}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 />
      </ToolbarButton>
      <ToolbarButton
        title="Bullet list"
        disabled={!ready}
        active={ready && editor?.isActive("bulletList")}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        title="Numbered list"
        disabled={!ready}
        active={ready && editor?.isActive("orderedList")}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        title="Quote"
        disabled={!ready}
        active={ready && editor?.isActive("blockquote")}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-border" />
      {inTable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Table options"
              onMouseDown={(e) => e.preventDefault()}
              className="flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-accent px-2 text-xs font-medium text-foreground [&_svg]:size-4"
            >
              <TableIcon /> Table <ChevronDown className="!size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onSelect={() => editor?.chain().focus().addRowAfter().run()}
            >
              <Plus /> Add row below
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => editor?.chain().focus().addColumnAfter().run()}
            >
              <Plus /> Add column right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => editor?.chain().focus().deleteRow().run()}
            >
              <Trash2 /> Delete row
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => editor?.chain().focus().deleteColumn().run()}
            >
              <Trash2 /> Delete column
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive [&_svg]:text-destructive"
              onSelect={() => editor?.chain().focus().deleteTable().run()}
            >
              <Trash2 /> Delete table
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <ToolbarButton
          title="Insert table"
          disabled={!ready}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <TableIcon />
        </ToolbarButton>
      )}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) insertImage(file);
          e.target.value = "";
        }}
      />
      <ToolbarButton
        title="Insert image"
        disabled={!ready}
        onClick={() => imageInputRef.current?.click()}
      >
        <ImagePlus />
      </ToolbarButton>
      <ToolbarButton
        title="Insert page break (select it and press Delete to remove)"
        disabled={!ready}
        onClick={() => editor?.chain().focus().setHorizontalRule().run()}
      >
        <SeparatorHorizontal />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-border" />
      <button
        type="button"
        title="Edit this section with AI"
        disabled={!ready}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onAskAi}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
      >
        <FiberAiIcon className="size-5" /> Ask AI
      </button>
      {!ready && (
        <span className="ml-2 text-xs text-muted-foreground">
          The document is busy
        </span>
      )}
    </div>
  );
}

/** Inline AI edit bar, Paperguide style: a free-form instruction input plus
 * quick actions with expandable tone and translate option rows. */
function AiBar({
  targetLabel,
  selectionPreview,
  onRun,
  onClose,
}: {
  targetLabel: string;
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
      className="rounded-2xl border border-border bg-popover p-2 font-sans text-base text-foreground shadow-[0_12px_40px_rgba(0,0,0,0.14)]"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="mb-2 line-clamp-2 rounded-lg bg-accent px-3 py-1.5 text-xs text-muted-foreground">
        {selectionPreview
          ? `Editing selection: "${selectionPreview}"`
          : `Editing section: ${targetLabel}`}
      </div>
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

/* ------------------------------------------------------------------
   AI side panel: a chat with the whole document. The agent answers
   questions and can rewrite, insert, or delete sections in one turn. */

const panelSuggestions = [
  "Tighten the abstract",
  "Make the whole article more formal",
  "Add a Limitations section before the Conclusion",
  "Fix grammar and typos across all sections",
];

function AiDocPanel({
  open,
  onClose,
  documentId,
  ensureSaved,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
  /** Flush any unsaved local edits before the agent reads the document. */
  ensureSaved: () => Promise<void>;
  onApplied: (document: DocumentDetail, reply: string) => void;
}) {
  const [messages, setMessages] = React.useState<DocumentChatTurn[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [seconds, setSeconds] = React.useState(0);
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!busy) return;
    setSeconds(0);
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [busy]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, busy]);

  function onAttach(files: File[]) {
    setAttachments((prev) => {
      const merged = [...prev];
      for (const file of files) {
        const duplicate = merged.some(
          (f) => f.name === file.name && f.size === file.size
        );
        if (!duplicate && merged.length < 5) merged.push(file);
      }
      return merged;
    });
  }

  /** Upload attachments into the paper library so their text is readable
   * by the agent. Returns the created paper ids, or null on failure. */
  async function uploadAttachments(): Promise<string[] | null> {
    if (attachments.length === 0) return [];
    setUploading(true);
    const uploaded: string[] = [];
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
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Some attachments could not be read: ${failures.join("; ")}`,
        },
      ]);
      setAttachments((prev) =>
        prev.filter((f) => failures.some((msg) => msg.startsWith(f.name)))
      );
      return null;
    }
    setAttachments([]);
    return uploaded;
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    const history = messages.slice(-12);
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setBusy(true);
    try {
      await ensureSaved();
      const attachmentIds = await uploadAttachments();
      if (attachmentIds === null) {
        setBusy(false);
        return;
      }
      const result = await apiFetch<DocumentChatResult>(
        `/v1/documents/${documentId}/chat`,
        {
          method: "POST",
          body: JSON.stringify({
            message: trimmed,
            history,
            attachment_paper_ids: attachmentIds,
          }),
        }
      );
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.reply },
      ]);
      if (result.changed) {
        onApplied(result.document, result.reply);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            e instanceof ApiError
              ? e.message
              : "The request failed. Is the Fiberarticle API running?",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const elapsed =
    seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-40 flex w-[min(400px,94vw)] flex-col border-l border-border bg-card transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <FiberAiIcon className="size-6" />
          Fiberarticle AI
        </span>
        <button
          type="button"
          aria-label="Close AI panel"
          onClick={onClose}
          className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !busy ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Ask anything about this article, or tell the AI what to change.
              It can rewrite sections, add new ones, fix the whole document,
              or just answer questions.
            </p>
            <div className="flex flex-col gap-1.5">
              {panelSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="cursor-pointer rounded-xl border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((message, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-6",
                  message.role === "user"
                    ? "self-end bg-[color-mix(in_oklab,var(--primary)_14%,transparent)]"
                    : "self-start border border-border bg-background"
                )}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 self-start px-1">
                <TextShimmer className="text-sm">
                  Reading the document and working
                </TextShimmer>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {elapsed}
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <form
        className="flex flex-col gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
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
        {/* One rounded field holding attach, the textarea, and send -
            buttons vertically centered, chat-app style. */}
        <div className="flex items-center gap-1 rounded-2xl border border-input px-1.5 py-1 transition-colors focus-within:border-ring">
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
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-full text-muted-foreground"
            type="button"
            aria-label="Attach files"
            title="Attach files (PDF, Word, text) as reference material"
            disabled={busy || uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip />
          </Button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length > 0) {
                e.preventDefault();
                onAttach(files);
              }
            }}
            rows={1}
            disabled={busy}
            placeholder="Ask for any edit or question..."
            className="fa-textarea-scroll max-h-32 min-h-9 flex-1 resize-none overflow-y-auto bg-transparent px-1.5 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <Button
            size="icon-sm"
            className="shrink-0 rounded-full"
            disabled={!input.trim() || busy || uploading}
            type="submit"
            aria-label="Send"
          >
            <ArrowUp />
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------
   Export preview: the real server-rendered PDF (exact pagination) or the
   standalone HTML, shown in a dialog before downloading anything. */

function PreviewDialog({
  open,
  onClose,
  documentId,
  ensureSaved,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
  ensureSaved: () => Promise<void>;
}) {
  const [format, setFormat] = React.useState<"pdf" | "html">("pdf");
  const [urls, setUrls] = React.useState<{ pdf?: string; html?: string }>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (fmt: "pdf" | "html") => {
      setLoading(true);
      setError(null);
      try {
        await ensureSaved();
        const token = await getApiToken();
        const path =
          fmt === "pdf"
            ? `/v1/documents/${documentId}/export-pdf`
            : `/v1/documents/${documentId}/export-html`;
        const res = await fetch(apiUrl(path), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setUrls((prev) => {
          if (prev[fmt]) URL.revokeObjectURL(prev[fmt]!);
          return { ...prev, [fmt]: url };
        });
      } catch {
        setError(
          "The preview could not be generated. Is the document ready and the API running?"
        );
      } finally {
        setLoading(false);
      }
    },
    [documentId, ensureSaved]
  );

  React.useEffect(() => {
    if (open && !urls[format] && !loading) load(format);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, format, urls]);

  // Closing drops the cached previews, so reopening always regenerates
  // from the latest saved content.
  React.useEffect(() => {
    if (open) return;
    setUrls((prev) => {
      Object.values(prev).forEach((u) => u && URL.revokeObjectURL(u));
      return {};
    });
    setFormat("pdf");
    setError(null);
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[92vh] w-[min(960px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <DialogPrimitive.Title className="flex items-center gap-2 text-sm font-semibold">
              <Eye className="size-4 text-muted-foreground" /> Export preview
            </DialogPrimitive.Title>
            <div className="flex items-center gap-1 rounded-full border border-border bg-muted/60 p-0.5">
              {(
                [
                  { key: "pdf", label: "PDF" },
                  { key: "html", label: "Web page" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFormat(tab.key)}
                  className={cn(
                    "cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    format === tab.key
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <span className="hidden text-[11px] text-muted-foreground sm:block">
              The PDF is the exact page-by-page result; Word follows the same
              layout.
            </span>
            <DialogPrimitive.Close asChild>
              <button
                aria-label="Close preview"
                className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </DialogPrimitive.Close>
          </div>
          <div className="relative min-h-0 flex-1 bg-[#525659]">
            {error ? (
              <div className="flex h-full items-center justify-center p-6">
                <Callout tone="error">{error}</Callout>
              </div>
            ) : loading || !urls[format] ? (
              <div className="flex h-full items-center justify-center">
                <TextShimmer className="text-sm">
                  Generating the export preview
                </TextShimmer>
              </div>
            ) : format === "pdf" ? (
              <iframe
                title="PDF preview"
                src={urls.pdf}
                className="h-full w-full border-0"
              />
            ) : (
              <iframe
                title="Web page preview"
                src={urls.html}
                sandbox=""
                className="h-full w-full border-0 bg-white"
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** File-type icon in the Untitled UI style: white sheet, folded corner,
 * colored format pill. Inline SVG so no external icon assets are needed. */
function FileFormatIcon({ label, color }: { label: string; color: string }) {
  return (
    <svg viewBox="0 0 40 40" className="!size-8 shrink-0" aria-hidden>
      <path
        d="M9 3.5 H24.5 L33 12 V34.5 A2.5 2.5 0 0 1 30.5 37 H9 A2.5 2.5 0 0 1 6.5 34.5 V6 A2.5 2.5 0 0 1 9 3.5 Z"
        fill="#ffffff"
        stroke="#D0D5DD"
        strokeWidth="1.6"
      />
      <path
        d="M24.5 3.5 V9.5 A2.5 2.5 0 0 0 27 12 H33"
        fill="none"
        stroke="#D0D5DD"
        strokeWidth="1.6"
      />
      <rect x="3" y="20" width="28" height="13" rx="3.5" fill={color} />
      <text
        x="17"
        y="29.6"
        textAnchor="middle"
        fontSize="8.6"
        fontWeight="700"
        fill="#ffffff"
        style={{ fontFamily: "var(--font-bricolage), sans-serif", letterSpacing: 0.3 }}
      >
        {label}
      </text>
    </svg>
  );
}

const exportFormats: {
  key: string;
  path: (id: string) => string;
  fallback: string;
  notice: string;
  label: string;
  description: string;
  badge: string;
  color: string;
}[] = [
  {
    key: "docx",
    path: (id) => `/v1/documents/${id}/export`,
    fallback: "article.docx",
    notice: "Word document (.docx) downloaded.",
    label: "Word (.docx)",
    description: "Microsoft Word, full layout",
    badge: "DOCX",
    color: "#155EEF",
  },
  {
    key: "pdf",
    path: (id) => `/v1/documents/${id}/export-pdf`,
    fallback: "article.pdf",
    notice: "PDF downloaded.",
    label: "PDF (.pdf)",
    description: "Print-ready document",
    badge: "PDF",
    color: "#D92D20",
  },
  {
    key: "html",
    path: (id) => `/v1/documents/${id}/export-html`,
    fallback: "article.html",
    notice: "Web page (.html) downloaded.",
    label: "Web page (.html)",
    description: "Standalone styled HTML",
    badge: "HTML",
    color: "#E62E05",
  },
  {
    key: "doc",
    path: (id) => `/v1/documents/${id}/export-doc`,
    fallback: "article.doc",
    notice: "Word 97 document (.doc) downloaded.",
    label: "Word 97 (.doc)",
    description: "Legacy Word format",
    badge: "DOC",
    color: "#2E90FA",
  },
  {
    key: "latex",
    path: (id) => `/v1/documents/${id}/export-latex`,
    fallback: "article-latex.zip",
    notice: "LaTeX project downloaded. Upload the zip to Overleaf to compile.",
    label: "LaTeX (.zip)",
    description: "Overleaf-ready project",
    badge: "TEX",
    color: "#099250",
  },
];

export function DocumentEditor({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [doc, setDoc] = React.useState<DocumentDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [exportBusy, setExportBusy] = React.useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  // Rendered reference list in the document's effective citation style, so
  // the page shows references exactly as they export.
  const [bibliography, setBibliography] = React.useState<Bibliography | null>(
    null
  );
  // The inline AI bar: which section it targets, and (optionally) the
  // selected passage it should edit instead of the whole section.
  const [aiBar, setAiBar] = React.useState<{
    sectionId: string;
    heading: string;
    selection: SelectionInfo | null;
  } | null>(null);
  // Floating "Ask AI" pill shown next to a fresh text selection.
  const [pill, setPill] = React.useState<{
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

  const docRef = React.useRef<DocumentDetail | null>(null);
  docRef.current = doc;
  const dirtyRef = React.useRef(false);
  dirtyRef.current = dirty;
  // The AI bar floats at the text it edits, positioned inside the page
  // wrapper so it scrolls with the content.
  const pageWrapRef = React.useRef<HTMLDivElement>(null);
  const [barTop, setBarTop] = React.useState(0);
  // The body markdown last applied to (or produced by) the editor; rebuilds
  // are skipped while local edits and state agree.
  const appliedBodyRef = React.useRef<string | null>(null);
  const editorDrivenRef = React.useRef(false);

  const mutate = React.useCallback(
    (updater: (d: DocumentDetail) => DocumentDetail) => {
      setDoc((prev) => (prev ? updater(prev) : prev));
      setDirty(true);
      setSaved(false);
    },
    []
  );

  const docMetaRef = React.useRef<FaDocMeta>({
    title: "",
    authors: [],
    disabled: false,
    numbered: true,
    upper: false,
    apa: false,
    onTitleChange: (title) => mutate((d) => ({ ...d, title })),
    onAuthorsChange: (authors) => mutate((d) => ({ ...d, authors })),
  });

  const editor = useEditor({
    extensions: [
      // Level 2 headings delimit sections; level 3 are in-section
      // subheadings. The horizontal rule ("---") is the manual page break.
      // StarterKit v3 already bundles underline. Paragraph and heading are
      // swapped for alignment-aware variants that serialize explicit
      // alignment as single-line HTML blocks.
      StarterKit.configure({ paragraph: false, heading: false }),
      MdParagraph,
      MdHeading.configure({ levels: [2, 3] }),
      TextAlign.configure({
        types: ["paragraph", "heading"],
        alignments: ["left", "center", "right", "justify"],
      }),
      Superscript,
      Subscript,
      TextStyle,
      FontFamily,
      FontSize,
      TableExtension.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      // Figures embedded as downscaled data URIs, so they live inside the
      // document itself and flow into every export.
      ImageExtension.configure({ inline: false, allowBase64: true }),
      TitleBlock,
      SectionNumbering,
      Markdown.configure({ html: true, transformPastedText: true }),
      // Real pagination: content is measured and flowed into A4 pages
      // (794x1123px at 96dpi) with margins, gaps, and per-page footers.
      PaginationPlus.configure({
        pageHeight: 1123,
        pageWidth: 794,
        marginTop: 96,
        marginBottom: 96,
        marginLeft: 96,
        marginRight: 96,
        pageGap: 44,
        pageGapBorderSize: 1,
        pageGapBorderColor: "var(--border)",
        pageBreakBackground: "var(--sidebar)",
        contentMarginTop: 0,
        contentMarginBottom: 0,
        footerRight: "Page {page}",
      }),
    ],
    content: "",
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "fa-prose min-h-6 outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      if (!editor.isEditable) return;
      const markdown = getMarkdown(editor);
      const current = docRef.current;
      if (!current) return;
      const next = splitSections(markdown, current.sections);
      editorDrivenRef.current = true;
      appliedBodyRef.current = buildBody(next);
      mutate((d) => ({ ...d, sections: next }));
    },
    onSelectionUpdate: ({ editor }) => {
      const { empty } = editor.state.selection;
      let { from, to } = editor.state.selection;
      if (empty) {
        setPill(null);
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
      const text = doc.textBetween(from, to, "\n");
      if (!text.trim()) {
        setPill(null);
        return;
      }
      const selection: SelectionInfo = {
        text,
        before: doc.textBetween(Math.max(0, from - 160), from, "\n"),
        after: doc.textBetween(to, Math.min(doc.content.size, to + 160), "\n"),
        from,
        to,
      };
      const coords = editor.view.coordsAtPos(from);
      setPill({
        selection,
        x: Math.min(Math.max(coords.left, 60), window.innerWidth - 80),
        y: Math.max(coords.top - 44, 12),
      });
    },
  });

  const load = React.useCallback(async () => {
    try {
      const data = await apiFetch<DocumentDetail>(`/v1/documents/${documentId}`);
      setDoc((prev) => {
        // Never clobber local unsaved edits with poll results.
        if (prev && dirtyRef.current) return prev;
        return data;
      });
      return data;
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not load this document."
      );
      return null;
    }
  }, [documentId]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Poll while generating so sections stream in as they are written.
  React.useEffect(() => {
    if (doc?.status !== "generating") return;
    const interval = setInterval(load, 2500);
    return () => clearInterval(interval);
  }, [doc?.status, load]);

  const generating = doc?.status === "generating";
  const layout = doc ? LAYOUT_FOR_TEMPLATE[doc.template] ?? "generic" : "generic";
  const pageStyle = PAGE_STYLES[layout];

  // Keep the editor's live meta (title block, numbering) in sync, then poke
  // an empty transaction so decorations recompute.
  React.useEffect(() => {
    if (!editor || !doc) return;
    const meta = docMetaRef.current;
    meta.title = doc.title;
    meta.authors = doc.authors;
    meta.disabled = generating || aiBusy;
    meta.numbered = pageStyle.numbered;
    meta.upper = pageStyle.upper;
    meta.apa = layout === "apa";
    (editor.storage as unknown as Record<string, unknown>).faDocMeta = meta;
    editor.view.dispatch(editor.state.tr);
  }, [editor, doc, generating, aiBusy, layout, pageStyle]);

  // Editable follows document status and AI activity.
  React.useEffect(() => {
    editor?.setEditable(!generating && !aiBusy && doc !== null, false);
  }, [editor, generating, aiBusy, doc]);

  // Images finish loading after layout; poke the pagination extension so
  // the page bands re-measure around the real image heights.
  React.useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onLoad = (event: Event) => {
      if (
        (event.target as HTMLElement).tagName === "IMG" &&
        !editor.isDestroyed
      ) {
        editor.view.dispatch(editor.state.tr);
      }
    };
    dom.addEventListener("load", onLoad, true);
    return () => dom.removeEventListener("load", onLoad, true);
  }, [editor]);

  // Rebuild the editor from sections whenever they changed outside the
  // editor itself (initial load, generation polling, AI edits).
  React.useEffect(() => {
    if (!editor || !doc) return;
    const body = buildBody(doc.sections);
    if (editorDrivenRef.current) {
      editorDrivenRef.current = false;
      appliedBodyRef.current = body;
      return;
    }
    if (appliedBodyRef.current === body) return;
    appliedBodyRef.current = body;
    // Microtask: NodeView creation calls flushSync, which React rejects
    // while a render/effect pass is still flushing.
    queueMicrotask(() => {
      if (!editor.isDestroyed) {
        editor.commands.setContent(body, { emitUpdate: false });
      }
    });
  }, [editor, doc]);

  const loadBibliography = React.useCallback(async () => {
    try {
      setBibliography(
        await apiFetch<Bibliography>(`/v1/documents/${documentId}/bibliography`)
      );
    } catch {
      setBibliography(null);
    }
  }, [documentId]);

  React.useEffect(() => {
    if (doc?.status === "ready" && doc.references.length > 0) {
      loadBibliography();
    }
  }, [doc?.status, doc?.references.length, loadBibliography]);

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
    if (!dirty || !doc || generating || saving || aiBusy) return;
    const timer = setTimeout(() => {
      onSave();
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, dirty, saving, aiBusy, generating]);

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

  async function onSave() {
    const current = docRef.current;
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<DocumentDetail>(
        `/v1/documents/${current.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            title: current.title,
            template: current.template,
            sections: current.sections,
            authors: current.authors,
            citation_style: current.citation_style,
          }),
        }
      );
      setDoc((prev) => {
        // Keep local content: the editor owns it while the page is open.
        if (!prev) return updated;
        return {
          ...updated,
          sections: prev.sections,
          title: prev.title,
          authors: prev.authors,
        };
      });
      setDirty(false);
      setSaved(true);
      if (updated.references.length > 0) loadBibliography();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const ensureSaved = React.useCallback(async () => {
    if (dirtyRef.current) await onSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function downloadExport(
    path: string,
    fallbackName: string,
    doneNotice: string,
    key: string
  ) {
    if (!doc) return;
    if (dirty) await onSave();
    setExportBusy(key);
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
      setExportBusy(null);
    }
  }

  function openSectionAi(selection: SelectionInfo | null) {
    const current = docRef.current;
    if (!current || !editor) return;
    const pos = selection ? selection.from : editor.state.selection.from;
    const index = Math.min(
      sectionIndexAtPos(editor, pos),
      current.sections.length - 1
    );
    const section = current.sections[index];
    if (!section) return;
    // Anchor the bar right under the selection (or caret) it edits.
    try {
      const coords = editor.view.coordsAtPos(
        selection ? selection.to : pos
      );
      const wrapper = pageWrapRef.current?.getBoundingClientRect();
      setBarTop(
        Math.max(0, wrapper ? coords.bottom - wrapper.top + 8 : 0)
      );
    } catch {
      setBarTop(0);
    }
    setPill(null);
    setAiBar({ sectionId: section.id, heading: section.heading, selection });
  }

  async function runAi(payload: AiPayload) {
    const current = docRef.current;
    const bar = aiBar;
    if (!current || !bar || !editor) return;
    const section = current.sections.find((s) => s.id === bar.sectionId);
    if (!section) return;
    if (dirty) await onSave();
    setAiBar(null);
    setPill(null);
    setAiBusy(true);
    setError(null);
    setNotice(null);
    const prev = section.content;
    try {
      const result = await apiFetch<{ section_id: string; content: string }>(
        `/v1/documents/${current.id}/edit`,
        {
          method: "POST",
          body: JSON.stringify({
            section_id: bar.sectionId,
            ...payload,
            ...(bar.selection && {
              selected_text: bar.selection.text,
              context_before: bar.selection.before,
              context_after: bar.selection.after,
            }),
          }),
        }
      );
      if (bar.selection) {
        // Splice the revised passage into the live editor; its own history
        // makes this undoable with Ctrl+Z, and autosave persists it.
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from: bar.selection.from, to: bar.selection.to },
            result.content
          )
          .run();
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
        setLastEdit({
          sectionId: bar.sectionId,
          heading: section.heading,
          prev,
        });
        setDirty(false);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The AI edit failed.");
    } finally {
      setAiBusy(false);
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

  function addSection() {
    if (!editor) return;
    editor
      .chain()
      .focus("end")
      .insertContent([
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "New section" }],
        },
        { type: "paragraph" },
      ])
      .run();
  }

  function jumpToSection(index: number) {
    const headings = editor?.view.dom.querySelectorAll("h2");
    headings?.[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
        <Skeleton className="h-[500px] w-full rounded-2xl" />
      </div>
    );
  }

  const prefixes = headingPrefixes(doc.sections, layout);
  const totalWords = doc.sections.reduce(
    (n, s) => n + s.content.split(/\s+/).filter(Boolean).length,
    0
  );
  const refsLabel = pageStyle.upper ? "REFERENCES" : "References";

  return (
    <div
      className={cn(
        "mx-auto flex max-w-[1400px] gap-8 pb-24 transition-[margin] duration-300",
        aiOpen && "xl:mr-[26rem]"
      )}
    >
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
              onClick={() => jumpToSection(i)}
              className="cursor-pointer truncate rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {prefixes[i]}
              {section.heading}
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

      <div className="flex min-w-0 max-w-4xl flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
                  onClick={() => setPreviewOpen(true)}
                  title="See exactly how the exported document will look"
                >
                  <Eye /> Preview
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" loading={exportBusy !== null}>
                      <Download /> Export
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel>Export as</DropdownMenuLabel>
                    {exportFormats.map((format) => (
                      <DropdownMenuItem
                        key={format.key}
                        className="gap-2.5"
                        onSelect={() =>
                          downloadExport(
                            format.path(doc.id),
                            format.fallback,
                            format.notice,
                            format.key
                          )
                        }
                      >
                        <FileFormatIcon
                          label={format.badge}
                          color={format.color}
                        />
                        <span className="flex flex-col">
                          <span>{format.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {format.description}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant={aiOpen ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setAiOpen((v) => !v)}
                >
                  <FiberAiIcon className="size-5" /> AI Chat
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

        {!generating && (
          <div className="flex flex-wrap items-center gap-2.5">
            <Select.Root
              value={doc.template}
              disabled={generating}
              onValueChange={(value) =>
                mutate((d) => ({
                  ...d,
                  template: value as DocumentTemplate,
                }))
              }
            >
              <Select.Trigger className="h-8 w-auto max-w-80 gap-1.5 text-xs">
                <span className="truncate">
                  Journal template:{" "}
                  {templates.find((t) => t.value === doc.template)?.label ??
                    doc.template}
                </span>
              </Select.Trigger>
              <Select.Content>
                {templates.map((t) => (
                  <Select.Item key={t.value} value={t.value}>
                    {t.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
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
            {pageStyle.twoColumnOnExport && (
              <span
                className="flex items-center gap-1 text-[11px] text-muted-foreground"
                title="The page edits in one column; the .docx and LaTeX exports use the journal's two-column layout."
              >
                <Columns2 className="size-3.5" /> Two-column on export
              </span>
            )}
          </div>
        )}

        {!generating && (
          <FormatToolbar editor={editor} onAskAi={() => openSectionAi(null)} />
        )}

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
        {/* The paged document: one editor, real A4 pages. The AI bar and
            its busy shimmer float at the exact text they edit. */}
        <div ref={pageWrapRef} className="relative">
          {aiBar && !aiBusy && (
            <div
              className="absolute inset-x-0 z-40"
              style={{ top: barTop }}
            >
              <AiBar
                targetLabel={aiBar.heading}
                selectionPreview={
                  aiBar.selection ? aiBar.selection.text.slice(0, 160) : null
                }
                onRun={runAi}
                onClose={() => setAiBar(null)}
              />
            </div>
          )}
          {aiBusy && (
            <div
              className="absolute inset-x-0 z-40 flex justify-center"
              style={{ top: barTop }}
            >
              <span className="rounded-full border border-border bg-popover px-4 py-1.5 shadow-lg">
                <TextShimmer className="text-sm">
                  Fiberarticle AI is rewriting this text
                </TextShimmer>
              </span>
            </div>
          )}
          <div
            className={cn("fa-page fa-paged", pageStyle.upper && "fa-upper")}
            style={pageVars(layout)}
          >
            <EditorContent editor={editor} />
          </div>
        </div>

        {generating && (
          <div className="flex flex-col gap-3">
            <TextShimmer className="text-sm">
              Writing the next section
            </TextShimmer>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}

        {!generating && (
          <button
            type="button"
            onClick={addSection}
            className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 font-sans text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" /> Add section
          </button>
        )}

        {/* Reference list on its own A4 sheet, rendered in the effective
            citation style so it reads exactly as the export will. */}
        {doc.references.length > 0 && (
          <div
            id="doc-references"
            className="fa-page scroll-mt-8 p-[96px]"
            style={pageVars(layout)}
          >
            <p className="font-bold" style={{ fontSize: "var(--pg-heading)" }}>
              {refsLabel}
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {(bibliography?.entries ?? doc.references.map(
                (p) =>
                  `${p.authors.slice(0, 6).join(", ") || "Unknown authors"} (${
                    p.year ?? "n.d."
                  }). ${p.title}.`
              )).map((entry, i) => (
                <p
                  key={i}
                  className="text-left"
                  style={
                    bibliography && !bibliography.numeric
                      ? { paddingLeft: "0.5in", textIndent: "-0.5in" }
                      : { textIndent: "0" }
                  }
                >
                  {(bibliography?.numeric ?? true) ? `[${i + 1}] ` : ""}
                  {entry}
                </p>
              ))}
            </div>
            <p className="mt-3 select-none font-sans text-[11px] text-muted-foreground">
              Formatted in {bibliography?.style ?? "the default style"} —
              placed on the final pages of every export.
            </p>
          </div>
        )}

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
            onClick={() => openSectionAi(pill.selection)}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-popover py-1 pl-1 pr-3 text-sm shadow-lg transition-colors hover:bg-accent"
          >
            <FiberAiIcon className="size-6" /> Ask AI
          </button>
        </div>
      )}

      {/* The real export, rendered before downloading anything. */}
      <PreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        documentId={doc.id}
        ensureSaved={ensureSaved}
      />

      {/* AI side panel: chat with (and edit) the whole document. */}
      <AiDocPanel
        open={aiOpen && !generating}
        onClose={() => setAiOpen(false)}
        documentId={doc.id}
        ensureSaved={ensureSaved}
        onApplied={(updated) => {
          setDoc(updated);
          setDirty(false);
          setSaved(true);
          setLastEdit(null);
          setNotice("AI edits applied to the document.");
        }}
      />
    </div>
  );
}
