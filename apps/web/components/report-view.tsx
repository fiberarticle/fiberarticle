"use client";

import type { Paper } from "@/lib/types";

/** Renders text with every [n] citation marker as a link to that paper. */
export function CitedText({ text, papers }: { text: string; papers: Paper[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\[(\d+)\]$/.exec(part);
        const paper = match ? papers[Number(match[1]) - 1] : undefined;
        if (paper?.url) {
          return (
            <a
              key={i}
              href={paper.url}
              target="_blank"
              rel="noreferrer"
              title={paper.title}
              className="font-medium text-[#4f90e4] hover:underline"
            >
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Inline **bold** inside report prose, with [n] markers still linked. */
function RichText({ text, papers }: { text: string; papers: Paper[] }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\*\*[^*]+\*\*$/.test(part) ? (
          <strong key={i} className="font-semibold">
            <CitedText text={part.slice(2, -2)} papers={papers} />
          </strong>
        ) : (
          <CitedText key={i} text={part} papers={papers} />
        )
      )}
    </>
  );
}

function MarkdownTable({ block, papers }: { block: string; papers: Paper[] }) {
  const rows = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  if (rows.length < 2) return null;
  const parse = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const header = parse(rows[0]);
  const body = rows
    .slice(1)
    .filter((line) => !/^\|[\s\-|:]+\|$/.test(line))
    .map(parse);
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/60">
          <tr>
            {header.map((cell, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells, r) => (
            <tr key={r} className="border-t border-border align-top">
              {cells.map((cell, c) => (
                <td key={c} className="min-w-52 px-3 py-2 leading-5">
                  <RichText text={cell} papers={papers} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The agent's markdown report: headings, paragraphs, bullets, and tables. */
export function ReportView({
  markdown,
  papers,
}: {
  markdown: string;
  papers: Paper[];
}) {
  const blocks = markdown.split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith("# ")) {
          return (
            <h1 key={i} className="text-2xl font-semibold tracking-tight">
              {trimmed.slice(2)}
            </h1>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h2 key={i} className="mt-2 text-lg font-semibold tracking-tight">
              {trimmed.slice(3)}
            </h2>
          );
        }
        if (trimmed.startsWith("|")) {
          return <MarkdownTable key={i} block={trimmed} papers={papers} />;
        }
        // A run of "- " lines is a real list, not a paragraph of dashes.
        const lines = trimmed.split("\n");
        if (lines.every((line) => line.trimStart().startsWith("- "))) {
          return (
            <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5">
              {lines.map((line, j) => (
                <li key={j} className="text-[15px] leading-7">
                  <RichText text={line.trimStart().slice(2)} papers={papers} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap text-[15px] leading-7">
            <RichText text={trimmed} papers={papers} />
          </p>
        );
      })}
    </div>
  );
}
