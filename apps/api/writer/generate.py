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


async def _retrieve_evidence(
    run_id: str, user_id: str, query: str, limit: int = 6
) -> list[dict]:
    vector = await embed_query(query)
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

        sections: list[dict] = []
        for heading, query, instructions in _SECTION_PLAN:
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
            sections.append(
                {
                    "id": str(uuid.uuid4()),
                    "heading": heading,
                    "content": content,
                }
            )
            # Persist progress after each section so the editor can stream it in.
            await execute(
                "UPDATE documents SET sections = %s, updated_at = now() WHERE id = %s",
                jsonb(sections),
                document_id,
            )

        await execute(
            "UPDATE documents SET status = 'ready', updated_at = now() WHERE id = %s",
            document_id,
        )
    except Exception as exc:
        logger.exception("document %s generation failed", document_id)
        await execute(
            "UPDATE documents SET status = 'failed', error = %s, updated_at = now() WHERE id = %s",
            str(exc),
            document_id,
        )


def start_generation(document_id: str, run_id: str, user_id: str) -> None:
    asyncio.create_task(generate_document(document_id, run_id, user_id))


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
