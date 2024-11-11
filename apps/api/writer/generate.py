"""Full research article generation from a completed run.

Produces a complete journal-style manuscript section by section. Every section
is grounded in the run's retrieved evidence chunks and cites papers with
bracketed numeric markers [n] that map to the run's paper list. Figures and
experimental results, which Fiberarticle cannot produce, are emitted as clearly
marked placeholders.
"""

import asyncio
import json
import logging
import re
import uuid

from db import execute, fetch_all, fetch_one, jsonb
from llm.client import ResolvedLlm, resolve_llm
from prefs import language_instruction
from rag.embeddings import embed_query

logger = logging.getLogger("fiberarticle.writer")

# heading, retrieval query template, extra instructions
_SECTION_PLAN: list[tuple[str, str, str]] = [
    (
        "Abstract",
        "{topic}",
        "Write a single-paragraph abstract of 150 to 250 words: motivation, gap, "
        "what this survey/study covers, and the main takeaways from the cited "
        "literature. No citations in the abstract, no headings.",
    ),
    (
        "Introduction",
        "background and motivation for {topic}",
        "Write the Introduction: motivate the problem, define key terms, state "
        "the gap in the literature, and preview the structure of the paper. "
        "3 to 5 paragraphs. Cite evidence with [n] markers.",
    ),
    (
        "Related Work",
        "prior work and existing approaches for {topic}",
        "Write the Related Work section as a critical synthesis of the cited "
        "papers, organized by theme rather than paper by paper. Compare "
        "approaches and identify disagreements. Cite heavily with [n] markers.",
    ),
    (
        "Methodology",
        "methods, datasets, and experimental design for {topic}",
        "Write the Methodology section describing a sound study design for this "
        "topic, grounded in methods that appear in the cited literature. Where "
        "a concrete artifact is needed, insert placeholders on their own line "
        "exactly like: [Figure 1: system architecture diagram - placeholder] or "
        "[Dataset details to be finalized - placeholder]. Cite methods with [n].",
    ),
    (
        "Results",
        "experimental results and evaluation metrics for {topic}",
        "Write the Results section as a scaffold: describe what will be "
        "measured and how it will be reported, referencing metrics used in the "
        "cited literature with [n]. Since experiments have not been run, every "
        "concrete number, table, or figure must be a placeholder on its own "
        "line, exactly like: [Table 1: comparison of methods - placeholder for "
        "experimental results] or [Figure 2: accuracy curves - placeholder].",
    ),
    (
        "Discussion",
        "implications, limitations, and open problems for {topic}",
        "Write the Discussion: interpret what the synthesized literature "
        "implies, limitations of current approaches, threats to validity, and "
        "open problems. Cite with [n] markers. 3 to 4 paragraphs.",
    ),
    (
        "Conclusion",
        "summary and future directions for {topic}",
        "Write a concise Conclusion: 1 to 2 paragraphs summarizing the "
        "contributions of the synthesis and concrete future directions. "
        "Citations optional.",
    ),
]

# Exposed so the API can report real "n of m sections" progress.
PLANNED_SECTION_COUNT = len(_SECTION_PLAN)

_active_tasks: dict[str, asyncio.Task] = {}


async def _retrieve_evidence(
    run_id: str, user_id: str, query: str, limit: int = 6
) -> list[dict]:
    try:
        vector = await embed_query(query)
    except Exception:
        # Embeddings unavailable: callers fall back to abstracts.
        logger.warning("embed_query failed; writing from abstracts")
        return []
    return await fetch_all(
        """
        SELECT paper_id, content
        FROM chunks
        WHERE run_id = %s AND user_id = %s
        ORDER BY embedding <=> %s::vector
        LIMIT %s
        """,
        run_id,
        user_id,
        str(vector),
        limit,
    )


def _reference_key(papers: list[dict]) -> str:
    return "\n".join(
        f"[{i + 1}] {p['title']} ({p.get('year') or 'n.d.'})"
        for i, p in enumerate(papers)
    )


async def _write_section(
    llm: ResolvedLlm,
    run_id: str,
    user_id: str,
    topic: str,
    heading: str,
    query: str,
    instructions: str,
    papers: list[dict],
    paper_index: dict[str, int],
    language: str = "",
) -> str:
    rows = await _retrieve_evidence(run_id, user_id, query.format(topic=topic))
    evidence = "\n\n".join(
        f"[{paper_index.get(str(r['paper_id']), '?')}] {r['content'][:900]}"
        for r in rows
    )
    if not evidence:
        evidence = "\n".join(
            f"[{i + 1}] {p.get('abstract') or p['title']}"
            for i, p in enumerate(papers[:8])
        )
    text = await llm.complete(
        [
            {
                "role": "system",
                "content": (
                    "You write one section of an academic research article in a "
                    "measured scholarly tone. Use ONLY the provided evidence "
                    "excerpts for factual claims and cite them with bracketed "
                    "numbers like [3] that match the reference key. Do not "
                    "invent citations. Do not include the section heading in "
                    "your output. Plain paragraphs only, no markdown headings. "
                    + instructions
                    + language
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Article topic: {topic}\n\n"
                    f"Section to write: {heading}\n\n"
                    f"Reference key:\n{_reference_key(papers)}\n\n"
                    f"Evidence excerpts:\n{evidence}"
                ),
            },
        ],
        max_tokens=1100,
        temperature=0.4,
    )
    return text.strip()


async def _generate_title(llm: ResolvedLlm, topic: str) -> str:
    try:
        text = await llm.complete(
            [
                {
                    "role": "system",
                    "content": (
                        "Produce one concise academic paper title (max 16 words) "
                        "for the given topic. Respond with ONLY the title, no "
                        "quotes, no period."
                    ),
                },
                {"role": "user", "content": topic},
            ],
            max_tokens=60,
            temperature=0.4,
        )
        title = text.strip().strip('"').strip()
        return title or topic
    except Exception:
        return topic


async def generate_document(document_id: str, run_id: str, user_id: str) -> None:
    try:
        run = await fetch_one(
            "SELECT * FROM runs WHERE id = %s AND user_id = %s", run_id, user_id
        )
        if run is None:
            raise ValueError("Run not found")
        topic = run["topic"]
        papers = await fetch_all(
            "SELECT * FROM papers WHERE run_id = %s AND user_id = %s ORDER BY created_at",
            run_id,
            user_id,
        )
        if not papers:
            raise ValueError("This run has no papers to cite")
        paper_index = {str(p["id"]): i + 1 for i, p in enumerate(papers)}

        llm = await resolve_llm(user_id)
        language = await language_instruction(user_id)

        title = await _generate_title(llm, topic)
        await execute(
            "UPDATE documents SET title = %s, updated_at = now() WHERE id = %s",
            title,
            document_id,
        )

        # Sections only depend on retrieval and the paper list, never on each
        # other, so write them concurrently. The semaphore keeps concurrency
        # polite toward free-tier providers; the lock serializes persistence
        # so the editor can stream sections in as each one lands.
        slots: list[dict | None] = [None] * len(_SECTION_PLAN)
        semaphore = asyncio.Semaphore(3)
        persist_lock = asyncio.Lock()

        async def write_one(index: int, heading: str, query: str, instructions: str) -> None:
            async with semaphore:
                content = await _write_section(
                    llm,
                    run_id,
                    user_id,
                    topic,
                    heading,
                    query,
                    instructions,
                    papers,
                    paper_index,
                    language,
                )
            slots[index] = {
                "id": str(uuid.uuid4()),
                "heading": heading,
                "content": content,
            }
            async with persist_lock:
                done = [slot for slot in slots if slot is not None]
                await execute(
                    "UPDATE documents SET sections = %s, updated_at = now() WHERE id = %s",
                    jsonb(done),
                    document_id,
                )

        await asyncio.gather(
            *(
                write_one(i, heading, query, instructions)
                for i, (heading, query, instructions) in enumerate(_SECTION_PLAN)
            )
        )

        await execute(
            "UPDATE documents SET status = 'ready', updated_at = now() WHERE id = %s",
            document_id,
        )
    except asyncio.CancelledError:
        # User pressed Stop: keep whatever sections landed and leave the
        # document editable instead of destroying the work.
        await execute(
            "UPDATE documents SET status = 'ready', updated_at = now() WHERE id = %s AND status = 'generating'",
            document_id,
        )
    except Exception as exc:
        logger.exception("document %s generation failed", document_id)
        await execute(
            "UPDATE documents SET status = 'failed', error = %s, updated_at = now() WHERE id = %s",
            str(exc),
            document_id,
        )
    finally:
        _active_tasks.pop(document_id, None)


def start_generation(document_id: str, run_id: str, user_id: str) -> None:
    task = asyncio.create_task(generate_document(document_id, run_id, user_id))
    _active_tasks[document_id] = task


def cancel_generation(document_id: str) -> bool:
    """Cancel the in-process generation task. Returns False when no task is
    live (already finished, or lost to an API restart)."""
    task = _active_tasks.get(document_id)
    if task is None or task.done():
        return False
    task.cancel()
    return True


# ------------------------------------------------------------------ agent
# The AI side panel: a document-level agent that answers questions and can
# rewrite, insert, or delete whole sections in one turn.

_AGENT_MAX_SECTION_CHARS = 4000
_AGENT_HISTORY_LIMIT = 12

_AGENT_SYSTEM = """You are Fiberarticle AI, the editing agent inside an \
academic article editor. You see the full document as a list of sections, \
each with a stable id. The user asks questions or requests edits; you decide \
what (if anything) to change.

Respond with ONLY a JSON object in this exact shape:
{
  "reply": "<short conversational answer describing what you did or answering the question>",
  "edits": [{"id": "<section id>", "heading": "<optional new heading>", "content": "<full replacement Markdown for that section>"}],
  "insert": [{"after_id": "<section id to insert after, or null for the start>", "heading": "<heading>", "content": "<Markdown>"}],
  "delete": ["<section id>"]
}

Rules:
- "reply" is always present. Use empty arrays when nothing changes.
- Content is Markdown. Allowed: paragraphs, **bold**, *italic*, ~~strike~~, \
`code`, <u>underline</u>, <sup>/<sub>, bullet and numbered lists, > quotes, \
### subheadings, GFM tables, [Figure/Table ... - placeholder] lines, and \
"---" on its own line for a manual page break.
- An aligned block appears as one single line like \
<p style="text-align: center">...</p>. Keep such lines as single lines and \
preserve their alignment unless asked to change it.
- An edit replaces the ENTIRE section content, so always return the full \
revised section, not a fragment.
- Preserve [n] citation markers exactly; cite only numbers that exist in the \
reference key. Never invent citations.
- Only include sections you actually change. Do not rewrite sections the \
user did not ask about unless the request is document-wide.
- Headings are plain text without any numbering ("Conclusion", not \
"4. Conclusion"); section numbers are applied automatically.
- Never delete every section."""

# Models sometimes echo list numbering into headings; numbering is applied
# at render time, so strip any "4. " / "IV. " prefix defensively.
_HEADING_NUMBER_RE = re.compile(r"^(?:\d+|[IVXLCM]+)[.)]\s+")


def _parse_json_object(text: str) -> dict | None:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _apply_agent_ops(
    sections: list[dict], parsed: dict
) -> tuple[list[dict], bool]:
    """Apply edits/insert/delete from the agent's JSON to the section list."""
    by_id: dict[str, dict] = {s["id"]: dict(s) for s in sections}
    order: list[str] = [s["id"] for s in sections]
    changed = False

    for edit in parsed.get("edits") or []:
        if not isinstance(edit, dict):
            continue
        section_id = edit.get("id")
        if section_id not in by_id:
            continue
        heading = edit.get("heading")
        if isinstance(heading, str) and heading.strip():
            by_id[section_id]["heading"] = _HEADING_NUMBER_RE.sub(
                "", heading.strip()
            )[:200]
            changed = True
        content = edit.get("content")
        if isinstance(content, str):
            by_id[section_id]["content"] = content
            changed = True

    for section_id in parsed.get("delete") or []:
        # Never let the agent empty the document.
        if section_id in by_id and len(order) > 1:
            order.remove(section_id)
            del by_id[section_id]
            changed = True

    for insert in parsed.get("insert") or []:
        if not isinstance(insert, dict):
            continue
        section = {
            "id": str(uuid.uuid4()),
            "heading": _HEADING_NUMBER_RE.sub(
                "", str(insert.get("heading") or "New section").strip()
            )[:200],
            "content": str(insert.get("content") or ""),
        }
        after_id = insert.get("after_id")
        if after_id in order:
            order.insert(order.index(after_id) + 1, section["id"])
        else:
            order.append(section["id"])
        by_id[section["id"]] = section
        changed = True

    return [by_id[section_id] for section_id in order], changed


async def run_document_agent(
    user_id: str,
    document: dict,
    papers: list[dict],
    message: str,
    history: list[dict],
    attachments: list[dict] | None = None,
) -> tuple[str, list[dict] | None]:
    """One side-panel turn. Returns (reply, new_sections or None).

    attachments: [{"title", "text"}] - files the user attached to this turn,
    provided to the model as reference material (not citable sources)."""
    llm = await resolve_llm(user_id)
    language = await language_instruction(user_id)
    sections = document.get("sections") or []

    catalog = "\n\n".join(
        f"[id={s['id']}] {s.get('heading') or 'Section'}\n"
        + (s.get("content") or "")[:_AGENT_MAX_SECTION_CHARS]
        for s in sections
    )
    context = (
        f"Document title: {document.get('title') or 'Untitled'}\n"
        f"Journal template: {document.get('template') or 'generic'}\n\n"
        f"Sections:\n{catalog or '(the document has no sections yet)'}"
    )
    if papers:
        context += f"\n\nReference key:\n{_reference_key(papers)}"
    if attachments:
        attached = "\n\n".join(
            f"--- Attached document: {a['title']} ---\n{a['text']}"
            for a in attachments
        )
        context += (
            "\n\nThe user attached these documents as reference material for "
            "this request. Use them to inform your answer or edits, but do "
            "NOT cite them with [n] markers (they are not in the reference "
            "key):\n" + attached
        )

    messages: list[dict] = [
        {"role": "system", "content": _AGENT_SYSTEM + language},
        *[
            {"role": turn["role"], "content": turn["content"]}
            for turn in history[-_AGENT_HISTORY_LIMIT:]
        ],
        {"role": "user", "content": f"{context}\n\nUser request: {message}"},
    ]

    text = await llm.complete(messages, max_tokens=3000, temperature=0.4)
    parsed = _parse_json_object(text)
    if parsed is None:
        # The model answered in prose; treat it as a reply with no edits.
        return text.strip() or "I could not process that request. Try rephrasing.", None

    reply = str(parsed.get("reply") or "").strip() or "Done."
    new_sections, changed = _apply_agent_ops(sections, parsed)
    return reply, new_sections if changed else None


EDIT_COMMANDS = {
    "rewrite": "Rewrite this text to improve clarity and flow while preserving every factual claim and every [n] citation marker.",
    "expand": "Expand this text with additional depth and connective reasoning, preserving all [n] citation markers and adding no invented facts.",
    "condense": "Condense this text to roughly two thirds of its length, preserving the key claims and all [n] citation markers.",
    "academic_tone": "Revise this text into a more formal academic register, preserving all facts and [n] citation markers.",
    "improve": "Improve the writing: sharpen clarity, tighten wording, and smooth the flow while preserving the meaning, every factual claim, and every [n] citation marker.",
    "simplify": "Simplify this text so a non-specialist can follow it: shorter sentences, plainer words, same structure of claims, and every [n] citation marker preserved.",
    "humanize": "Rewrite this text so it reads as natural, varied human prose: vary sentence length, remove formulaic constructions and filler, and keep every fact and [n] citation marker.",
}


def _edit_instruction(
    command: str,
    instruction: str | None,
    tone: str | None,
    target_language: str | None,
) -> str:
    if command == "tone":
        return (
            f"Rewrite this text in a {tone} tone, preserving all facts and "
            "every [n] citation marker."
        )
    if command == "translate":
        return (
            f"Translate this text into {target_language}. Keep technical "
            "terms, paper titles, proper nouns, and [n] citation markers "
            "exactly as they are."
        )
    if command == "custom":
        return (
            "Follow this editing instruction from the author. Unless the "
            "instruction says otherwise, preserve all factual claims and "
            f"every [n] citation marker. Instruction: {instruction}"
        )
    return EDIT_COMMANDS[command]


async def run_edit_command(
    user_id: str,
    command: str,
    heading: str,
    content: str,
    *,
    instruction: str | None = None,
    tone: str | None = None,
    target_language: str | None = None,
    selected_text: str | None = None,
    context_before: str = "",
    context_after: str = "",
) -> str:
    """Run one AI edit. With selected_text, revise only that passage and
    return the replacement; otherwise revise and return the whole section."""
    llm = await resolve_llm(user_id)
    # Translation targets a specific language; do not also inject the
    # user's default prose-language preference.
    language = "" if command == "translate" else await language_instruction(user_id)
    task = _edit_instruction(command, instruction, tone, target_language)

    markdown_note = (
        " The text may contain Markdown formatting (bold, italic, lists); "
        "preserve that formatting unless the instruction says otherwise."
    )

    if selected_text is not None:
        system = (
            "You edit one passage from a section of an academic paper. "
            + task
            + markdown_note
            + " You are given the full section for context, but revise ONLY "
            "the passage. Respond with ONLY the revised passage: no headings, "
            "no preamble, no quotation marks around it, and do not repeat the "
            "surrounding text. The revision replaces the passage exactly "
            "in place, so it must splice seamlessly into the surrounding "
            "sentence: do not add trailing punctuation the original passage "
            "did not have, and match how it starts (capitalized or not)."
            + language
        )
        boundaries = ""
        if context_before:
            boundaries += (
                f"\n\nText immediately BEFORE the passage (do not repeat it):"
                f"\n...{context_before}"
            )
        if context_after:
            boundaries += (
                f"\n\nText immediately AFTER the passage (do not repeat or "
                f"continue into it):\n{context_after}..."
            )
        user = (
            f"Section: {heading}\n\n"
            f"Full section for context:\n{content}\n\n"
            f"Passage to revise:\n{selected_text}"
            f"{boundaries}"
        )
    else:
        system = (
            "You edit one section of an academic paper. "
            + task
            + markdown_note
            + " Respond with ONLY the revised section text, no headings, no preamble."
            + language
        )
        user = f"Section: {heading}\n\n{content}"

    text = await llm.complete(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=1400,
        temperature=0.4,
    )
    return text.strip()
