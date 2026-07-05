"""The Assistant: ReAct-agent conversations that answer any question, using
the user's library and live scholarly search as tools, with the reasoning
steps and passage-level citations stored alongside every answer."""

from fastapi import APIRouter, HTTPException

from agent.assistant import AssistantAgent
from db import execute, fetch_all, fetch_one, jsonb
from llm.client import LlmNotConfigured, resolve_llm
from llm.titles import schedule_title
from models import (
    ChatMessageIn,
    ChatMessageOut,
    ConversationCreateIn,
    ConversationOut,
    ConversationUpdate,
)
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
        pinned=bool(row.get("pinned")),
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
    # An empty library is fine: the ReAct agent can search the literature
    # live or answer general questions directly.

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


@router.patch("/{conversation_id}", response_model=ConversationOut)
async def update_conversation(
    conversation_id: str, body: ConversationUpdate, user_id: str = CurrentUser
) -> ConversationOut:
    await _get_owned_conversation(conversation_id, user_id)
    if body.title is not None:
        await execute(
            "UPDATE conversations SET title = %s, updated_at = now() WHERE id = %s",
            body.title.strip(),
            conversation_id,
        )
    if body.pinned is not None:
        await execute(
            "UPDATE conversations SET pinned = %s, updated_at = now() WHERE id = %s",
            body.pinned,
            conversation_id,
        )
    return _conversation_out(await _get_owned_conversation(conversation_id, user_id))


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
            steps=r.get("steps"),
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.post("/{conversation_id}/messages", response_model=list[ChatMessageOut])
async def send_message(
    conversation_id: str, body: ChatMessageIn, user_id: str = CurrentUser
) -> list[ChatMessageOut]:
    conversation = await _get_owned_conversation(conversation_id, user_id)
    try:
        llm = await resolve_llm(user_id)
    except LlmNotConfigured as exc:
        raise HTTPException(409, str(exc))

    history = await fetch_all(
        "SELECT role, content FROM chat_messages WHERE conversation_id = %s ORDER BY id DESC LIMIT %s",
        conversation_id,
        _HISTORY_LIMIT,
    )
    history = list(reversed(history))

    agent = AssistantAgent(llm, user_id, dict(conversation))
    result = await agent.run(body.content, history)
    answer = result["answer"].strip()
    if not answer:
        raise HTTPException(502, "The model returned an empty answer. Try again.")

    await execute(
        "INSERT INTO chat_messages (conversation_id, user_id, role, content) VALUES (%s, %s, 'user', %s)",
        conversation_id,
        user_id,
        body.content,
    )
    await execute(
        "INSERT INTO chat_messages (conversation_id, user_id, role, content, citations, steps) VALUES (%s, %s, 'assistant', %s, %s, %s)",
        conversation_id,
        user_id,
        answer,
        jsonb(result["citations"]),
        jsonb(result["steps"]) if result["steps"] else None,
    )
    title_update = (
        body.content[:110] if conversation["title"] in ("Library chat",) else None
    )
    await execute(
        "UPDATE conversations SET updated_at = now(), title = COALESCE(%s, title) WHERE id = %s",
        title_update,
        conversation_id,
    )
    # First exchange: replace the fallback title with an AI one, in the
    # background so the reply is never delayed.
    if not history:
        schedule_title("conversation", conversation_id, user_id, body.content)
    return await list_messages(conversation_id, user_id)
