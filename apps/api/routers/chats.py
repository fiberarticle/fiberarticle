"""Chat with your papers: single-paper or whole-library conversations with
retrieval-grounded answers and passage-level citations."""

from fastapi import APIRouter, HTTPException

from db import execute, fetch_all, fetch_one, jsonb
from llm.client import LlmNotConfigured, resolve_llm
from models import (
    ChatMessageIn,
    ChatMessageOut,
    ConversationCreateIn,
    ConversationOut,
)
from rag.embeddings import embed_query
from security import CurrentUser

router = APIRouter(prefix="/v1/chats", tags=["chats"])

_HISTORY_LIMIT = 12


def _conversation_out(row: dict) -> ConversationOut:
    return ConversationOut(
        id=str(row["id"]),
        scope=row["scope"],
        paper_id=str(row["paper_id"]) if row["paper_id"] else None,
        paper_title=row.get("paper_title"),
        title=row["title"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def _get_owned_conversation(conversation_id: str, user_id: str) -> dict:
    row = await fetch_one(
        """
        SELECT c.*, p.title AS paper_title
        FROM conversations c
        LEFT JOIN papers p ON p.id = c.paper_id
        WHERE c.id = %s AND c.user_id = %s
        """,
        conversation_id,
        user_id,
    )
    if row is None:
        raise HTTPException(404, "Conversation not found")
    return row


@router.get("", response_model=list[ConversationOut])
async def list_conversations(user_id: str = CurrentUser) -> list[ConversationOut]:
    rows = await fetch_all(
        """
        SELECT c.*, p.title AS paper_title
        FROM conversations c
        LEFT JOIN papers p ON p.id = c.paper_id
        WHERE c.user_id = %s ORDER BY c.updated_at DESC LIMIT 100
        """,
        user_id,
    )
    return [_conversation_out(r) for r in rows]


@router.post("", response_model=ConversationOut, status_code=201)
async def create_conversation(
    body: ConversationCreateIn, user_id: str = CurrentUser
) -> ConversationOut:
    paper_title = None
    if body.scope == "paper":
        if not body.paper_id:
            raise HTTPException(422, "A paper conversation needs a paper_id.")
        paper = await fetch_one(
            "SELECT * FROM papers WHERE id = %s AND user_id = %s",
            body.paper_id,
            user_id,
        )
        if paper is None:
            raise HTTPException(404, "Paper not found")
        paper_title = paper["title"]
    else:
        count = await fetch_one(
            "SELECT count(*) AS n FROM papers WHERE user_id = %s", user_id
        )
        if not count or count["n"] == 0:
            raise HTTPException(
                409, "Your library is empty. Add papers before starting a chat."
            )

    row = await fetch_one(
        """
        INSERT INTO conversations (user_id, scope, paper_id, title)
        VALUES (%s, %s, %s, %s)
        RETURNING *
        """,
        user_id,
        body.scope,
        body.paper_id,
        paper_title[:120] if paper_title else "Library chat",
    )
    row["paper_title"] = paper_title
    return _conversation_out(row)


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str, user_id: str = CurrentUser
) -> None:
    await _get_owned_conversation(conversation_id, user_id)
    await execute("DELETE FROM conversations WHERE id = %s", conversation_id)


@router.get("/{conversation_id}/messages", response_model=list[ChatMessageOut])
async def list_messages(
    conversation_id: str, user_id: str = CurrentUser
) -> list[ChatMessageOut]:
    await _get_owned_conversation(conversation_id, user_id)
    rows = await fetch_all(
        "SELECT * FROM chat_messages WHERE conversation_id = %s ORDER BY id",
        conversation_id,
    )
    return [
        ChatMessageOut(
            id=r["id"],
            role=r["role"],
            content=r["content"],
            citations=r["citations"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


async def _retrieve(
    user_id: str, conversation: dict, question: str, limit: int = 8
) -> list[dict]:
    vector = await embed_query(question)
    if conversation["scope"] == "paper":
        return await fetch_all(
            """
            SELECT ch.content, ch.paper_id, p.title
            FROM chunks ch JOIN papers p ON p.id = ch.paper_id
            WHERE ch.user_id = %s AND ch.paper_id = %s
            ORDER BY ch.embedding <=> %s::vector LIMIT %s
            """,
            user_id,
            conversation["paper_id"],
            str(vector),
            limit,
        )
    return await fetch_all(
        """
        SELECT ch.content, ch.paper_id, p.title
        FROM chunks ch JOIN papers p ON p.id = ch.paper_id
        WHERE ch.user_id = %s
        ORDER BY ch.embedding <=> %s::vector LIMIT %s
        """,
        user_id,
        str(vector),
        limit,
    )


@router.post("/{conversation_id}/messages", response_model=list[ChatMessageOut])
async def send_message(
    conversation_id: str, body: ChatMessageIn, user_id: str = CurrentUser
) -> list[ChatMessageOut]:
    conversation = await _get_owned_conversation(conversation_id, user_id)
    try:
        llm = await resolve_llm(user_id)
    except LlmNotConfigured as exc:
        raise HTTPException(409, str(exc))

    evidence = await _retrieve(user_id, conversation, body.content)
    if not evidence:
        raise HTTPException(
            409,
            "No indexed text is available for this scope yet. Upload the PDF or "
            "wait for open-access ingestion to finish.",
        )

    history = await fetch_all(
        "SELECT role, content FROM chat_messages WHERE conversation_id = %s ORDER BY id DESC LIMIT %s",
        conversation_id,
        _HISTORY_LIMIT,
    )
    history = list(reversed(history))

    context = "\n\n".join(
        f"[{i + 1}] From \"{e['title'][:90]}\":\n{e['content'][:900]}"
        for i, e in enumerate(evidence)
    )
    scope_line = (
        f'the paper "{conversation.get("paper_title")}"'
        if conversation["scope"] == "paper"
        else "the user's research library"
    )
    messages = [
        {
            "role": "system",
            "content": (
                f"You answer questions about {scope_line} using ONLY the numbered "
                "excerpts provided. Cite every claim with bracketed numbers like "
                "[2] matching the excerpts. If the excerpts do not contain the "
                "answer, say so honestly. Be concise and precise."
            ),
        },
        *[{"role": h["role"], "content": h["content"]} for h in history],
        {
            "role": "user",
            "content": f"Excerpts:\n{context}\n\nQuestion: {body.content}",
        },
    ]
    answer = (await llm.complete(messages, max_tokens=900)).strip()
    if not answer:
        raise HTTPException(502, "The model returned an empty answer. Try again.")

    citations = [
        {
            "paper_id": str(e["paper_id"]),
            "title": e["title"],
            "quote": e["content"][:280],
        }
        for e in evidence
    ]

    await execute(
        "INSERT INTO chat_messages (conversation_id, user_id, role, content) VALUES (%s, %s, 'user', %s)",
        conversation_id,
        user_id,
        body.content,
    )
    await execute(
        "INSERT INTO chat_messages (conversation_id, user_id, role, content, citations) VALUES (%s, %s, 'assistant', %s, %s)",
        conversation_id,
        user_id,
        answer,
        jsonb(citations),
    )
    title_update = (
        body.content[:110] if conversation["title"] in ("Library chat",) else None
    )
    await execute(
        "UPDATE conversations SET updated_at = now(), title = COALESCE(%s, title) WHERE id = %s",
        title_update,
        conversation_id,
    )
    return await list_messages(conversation_id, user_id)
