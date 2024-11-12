"use client";

/**
 * Custom TipTap pieces for the single-instance document editor:
 *
 * - TitleBlock: an atom NodeView holding the article title and authors as
 *   real inputs INSIDE the paginated flow, so page 1 looks like the export.
 *   It serializes to nothing in Markdown and is re-inserted if deleted.
 * - SectionNumbering: decorations that prefix every level-2 heading with its
 *   template number ("1. " / "I. "), skip the Abstract, and center the
 *   Abstract heading for APA. Reads live config from editor.storage.faDocMeta.
 */

import * as React from "react";
import { Extension, getHTMLFromFragment, Node } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";
import Paragraph from "@tiptap/extension-paragraph";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Fragment } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface FaDocMeta {
  title: string;
  authors: string[];
  disabled: boolean;
  numbered: boolean;
  upper: boolean;
  apa: boolean;
  onTitleChange: (title: string) => void;
  onAuthorsChange: (authors: string[]) => void;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function isAbstractText(text: string): boolean {
  return text.trim().toLowerCase() === "abstract";
}

/* ------------------------------------------------------------------ */

function TitleView({ editor }: NodeViewProps) {
  const meta = (editor.storage as unknown as Record<string, unknown>)
    .faDocMeta as FaDocMeta;
  const [title, setTitle] = React.useState(meta?.title ?? "");
  const [authors, setAuthors] = React.useState(
    (meta?.authors ?? []).join(", ")
  );
  const titleRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-grow the title. The NodeView mounts before the pagination layout
  // settles, so a single measure can read 0; retry on frames and observe
  // width changes until a real height lands. Every height change must poke
  // an empty transaction: the pagination extension sizes its page bands
  // from the editor's scrollHeight, and a late-growing title would leave
  // the bands overlapping (and swallowing clicks on) the text below.
  const lastHeightRef = React.useRef(0);
  React.useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const resize = () => {
      el.style.height = "auto";
      const next = Math.max(el.scrollHeight, 0);
      el.style.height = `${next}px`;
      if (next !== lastHeightRef.current) {
        lastHeightRef.current = next;
        requestAnimationFrame(() => {
          if (!editor.isDestroyed) {
            editor.view.dispatch(editor.state.tr);
          }
        });
      }
    };
    resize();
    let attempts = 0;
    let frame = 0;
    const retry = () => {
      if (el.scrollHeight > 0 || attempts > 20) {
        resize();
        return;
      }
      attempts += 1;
      frame = requestAnimationFrame(retry);
    };
    frame = requestAnimationFrame(retry);
    const observer = new ResizeObserver(resize);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [title, editor]);

  return (
    <NodeViewWrapper
      data-fa-title
      contentEditable={false}
      className="block select-none"
    >
      <textarea
        ref={titleRef}
        value={title}
        rows={1}
        disabled={meta?.disabled}
        onChange={(e) => {
          const value = e.target.value.replace(/\n/g, " ");
          setTitle(value);
          meta?.onTitleChange(value);
        }}
        className="w-full resize-none overflow-hidden border-none bg-transparent text-center font-bold leading-tight outline-none disabled:opacity-70"
        style={{
          fontSize: "var(--pg-title)",
          fontFamily: "inherit",
          minHeight: "1.3em",
        }}
        placeholder="Article title"
      />
      <input
        value={authors}
        disabled={meta?.disabled}
        onChange={(e) => {
          setAuthors(e.target.value);
          meta?.onAuthorsChange(
            e.target.value
              .split(",")
              .map((a) => a.trim())
              .filter(Boolean)
          );
        }}
        placeholder="Authors (comma separated)"
        className="mt-2 w-full border-none bg-transparent text-center outline-none disabled:opacity-70"
        style={{ fontFamily: "inherit", fontSize: "inherit" }}
      />
      <div className="fa-page-divider mb-6 mt-5" />
    </NodeViewWrapper>
  );
}

export const TitleBlock = Node.create({
  name: "titleBlock",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,

  parseHTML() {
    return [{ tag: "div[data-fa-title]" }];
  },

  renderHTML() {
    return ["div", { "data-fa-title": "" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TitleView, {
      // The inputs inside must receive their own keyboard/mouse events.
      stopEvent: () => true,
    });
  },

  addStorage() {
    return {
      // tiptap-markdown: serialize to nothing so the title block never
      // leaks into the stored section Markdown.
      markdown: {
        serialize: () => {},
        parse: {},
      },
    };
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      // The title block must always be the first node; re-insert it if an
      // edit (Ctrl+A + Delete, for example) removed it.
      new Plugin({
        key: new PluginKey("faTitleGuard"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const first = newState.doc.firstChild;
          if (first && first.type === type) return null;
          return newState.tr.insert(0, type.create());
        },
      }),
    ];
  },
});

/* ------------------------------------------------------------------
   Alignment-aware Markdown serialization. Markdown has no syntax for text
   alignment, so an explicitly aligned block is stored as one single-line
   HTML block ("<p style=\"text-align: center\">...</p>") that round-trips
   through the parser and that every exporter understands. Level-2 headings
   always stay as "## " lines because they delimit sections. */

const EXPLICIT_ALIGNMENTS = new Set(["left", "center", "right"]);

/* eslint-disable @typescript-eslint/no-explicit-any */

function nodeInnerHtml(node: any): string {
  return getHTMLFromFragment(
    Fragment.from(node.content),
    node.type.schema
  ).replace(/\n/g, " ");
}

/* Headings always take the template's font, so a per-character font mark on
   heading text is meaningless; serializing it would leak a raw <span> into
   the "## " line and from there into section titles. */
function withoutFontMarks(node: any): any {
  const textStyle = node.type.schema.marks.textStyle;
  if (!textStyle) return node;
  const cleaned: any[] = [];
  node.content.forEach((child: any) => {
    cleaned.push(
      child.mark(child.marks.filter((m: any) => m.type !== textStyle))
    );
  });
  return node.copy(Fragment.from(cleaned));
}

export const MdParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const align = node.attrs.textAlign;
          if (EXPLICIT_ALIGNMENTS.has(align)) {
            state.write(
              `<p style="text-align: ${align}">${nodeInnerHtml(node)}</p>`
            );
            state.closeBlock(node);
          } else {
            state.renderInline(node);
            state.closeBlock(node);
          }
        },
        parse: {},
      },
    };
  },
});

export const MdHeading = Heading.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const level = node.attrs.level;
          const align = node.attrs.textAlign;
          if (level >= 3 && EXPLICIT_ALIGNMENTS.has(align)) {
            state.write(
              `<h${level} style="text-align: ${align}">${nodeInnerHtml(withoutFontMarks(node))}</h${level}>`
            );
            state.closeBlock(node);
          } else {
            state.write(state.repeat("#", level) + " ");
            state.renderInline(withoutFontMarks(node));
            state.closeBlock(node);
          }
        },
        parse: {},
      },
    };
  },
});

/* eslint-enable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */

export const sectionNumberingKey = new PluginKey("faSectionNumbering");

export const SectionNumbering = Extension.create({
  name: "faSectionNumbering",

  addProseMirrorPlugins() {
    const getMeta = () =>
      (this.editor?.storage as unknown as Record<string, unknown> | undefined)
        ?.faDocMeta as FaDocMeta | undefined;

    return [
      new Plugin({
        key: sectionNumberingKey,
        props: {
          decorations(state) {
            const meta = getMeta();
            if (!meta) return DecorationSet.empty;
            const decorations: Decoration[] = [];
            let counter = 0;
            state.doc.forEach((node, offset) => {
              if (node.type.name !== "heading" || node.attrs.level !== 2) {
                return;
              }
              const abstract = isAbstractText(node.textContent);
              if (meta.apa && abstract) {
                decorations.push(
                  Decoration.node(offset, offset + node.nodeSize, {
                    class: "fa-h2-center",
                  })
                );
              }
              if (!meta.numbered || abstract) return;
              counter += 1;
              const label = meta.upper
                ? `${ROMAN[Math.min(counter - 1, ROMAN.length - 1)]}. `
                : `${counter}. `;
              decorations.push(
                Decoration.widget(
                  offset + 1,
                  () => {
                    const span = document.createElement("span");
                    span.className = "fa-seclabel";
                    span.textContent = label;
                    span.contentEditable = "false";
                    return span;
                  },
                  { side: -1, key: `sec-${counter}-${label}` }
                )
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
