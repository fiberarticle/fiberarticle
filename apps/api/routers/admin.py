"""
Admin API.

Every route here is gated by AdminUser, which reads the role out of the signed
token. There is no second way in: the web page hiding its menu entry is only
cosmetic, and this module is what actually decides who may read or change other
people's data.

Two sets of tables are involved, both in the same Postgres database:

  owned by Better Auth (through Prisma)  "user", "session", "account"
  owned by this API (created in db.py)   llm_config, runs, run_events, papers,
                                         chunks, documents, conversations,
                                         chat_messages, user_prefs, extractions

They are joined on the user id, which this API stores as plain text with no
foreign key back to "user". That is why deleting an account has to clear both
sides by hand: Postgres will not cascade across that boundary for us.

"user" is a reserved word in Postgres, so it is quoted everywhere below.
"""

import re
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from db import execute, fetch_all, fetch_one, get_pool
from models import CAPS, LlmMode
from security import AdminUser

router = APIRouter(prefix="/v1/admin", tags=["admin"])

# Plain pattern rather than pydantic's EmailStr: that pulls in the
# email-validator package, which is not in requirements.txt, and adding a
# dependency to the API for one admin-only field is not worth it. This only has
# to catch a typo in an address an admin is editing by hand.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Every table this API owns that is keyed by user id. Order matters on delete:
# children before parents, so nothing is left pointing at a row that has gone.
# journal_ranks is deliberately absent, it is shared reference data and belongs
# to nobody.
USER_OWNED_TABLES = (
    "chat_messages",
    "conversations",
    "chunks",
    "papers",
    "run_events",
    "documents",
    "extractions",
    "runs",
    "user_prefs",
    "llm_config",
)


# ---------------------------------------------------------------- shapes


class AdminUserRow(BaseModel):
    id: str
    name: str
    email: str
    email_verified: bool
    role: str
    image: str | None
    created_at: datetime
    ai_mode: str | None
    ai_provider: str | None
    ai_model: str | None
    has_key: bool
    reasoning: bool
    run_count: int
    document_count: int
    paper_count: int
    active_sessions: int
    last_seen: datetime | None


class AdminUserList(BaseModel):
    users: list[AdminUserRow]
    total: int


class CountPoint(BaseModel):
    label: str
    value: int


class Overview(BaseModel):
    total_users: int
    verified_users: int
    unverified_users: int
    admin_users: int
    users_with_live_session: int
    total_runs: int
    total_documents: int
    total_papers: int
    runs_running: int
    runs_failed: int
    signups_by_day: list[CountPoint]
    users_by_ai_mode: list[CountPoint]
    runs_by_day: list[CountPoint]
    runs_by_status: list[CountPoint]


class UserPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, min_length=3, max_length=254)
    email_verified: bool | None = None
    role: Literal["user", "admin"] | None = None


class AiPatch(BaseModel):
    mode: LlmMode
    provider: str | None = None
    model: str | None = None
    base_url: str | None = None
    reasoning: bool = False


class WorkItem(BaseModel):
    id: str
    kind: str
    title: str
    status: str | None
    created_at: datetime


class UserDetail(BaseModel):
    user: AdminUserRow
    sessions: list[dict]
    accounts: list[dict]
    work: list[WorkItem]


class Ok(BaseModel):
    ok: bool = True
    message: str


# ---------------------------------------------------------------- helpers


async def _require_user(user_id: str) -> dict:
    row = await fetch_one('SELECT * FROM "user" WHERE id = %s', user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No such user")
    return row


def _row_to_user(row: dict) -> AdminUserRow:
    return AdminUserRow(
        id=row["id"],
        name=row["name"],
        email=row["email"],
        email_verified=bool(row["emailVerified"]),
        role=row.get("role") or "user",
        image=row.get("image"),
        created_at=row["createdAt"],
        ai_mode=row.get("mode"),
        ai_provider=row.get("provider"),
        ai_model=row.get("model"),
        has_key=row.get("encrypted_key") is not None,
        reasoning=bool(row.get("reasoning")),
        run_count=int(row.get("run_count") or 0),
        document_count=int(row.get("document_count") or 0),
        paper_count=int(row.get("paper_count") or 0),
        active_sessions=int(row.get("active_sessions") or 0),
        last_seen=row.get("last_seen"),
    )


# One shared SELECT so the list and the single-user view can never drift apart
# and show different numbers for the same person.
_USER_SELECT = """
    SELECT u.id,
           u.name,
           u.email,
           u."emailVerified",
           u.image,
           u."createdAt",
           COALESCE(u.role, 'user') AS role,
           c.mode,
           c.provider,
           c.model,
           c.encrypted_key,
           COALESCE(c.reasoning, false) AS reasoning,
           (SELECT count(*) FROM runs r WHERE r.user_id = u.id)          AS run_count,
           (SELECT count(*) FROM documents d WHERE d.user_id = u.id)     AS document_count,
           (SELECT count(*) FROM papers p WHERE p.user_id = u.id)        AS paper_count,
           (SELECT count(*) FROM "session" s
             WHERE s."userId" = u.id AND s."expiresAt" > now())          AS active_sessions,
           (SELECT max(s."updatedAt") FROM "session" s
             WHERE s."userId" = u.id)                                    AS last_seen
      FROM "user" u
      LEFT JOIN llm_config c ON c.user_id = u.id
"""


# ---------------------------------------------------------------- overview


@router.get("/overview", response_model=Overview)
async def overview(admin_id: str = AdminUser) -> Overview:
    """Everything the dashboard cards and the four charts need, in one call."""
    totals = await fetch_one(
        """
        SELECT
          (SELECT count(*) FROM "user")                                        AS total_users,
          (SELECT count(*) FROM "user" WHERE "emailVerified")                  AS verified_users,
          (SELECT count(*) FROM "user" WHERE COALESCE(role,'user') = 'admin')  AS admin_users,
          (SELECT count(DISTINCT "userId") FROM "session"
            WHERE "expiresAt" > now())                                         AS live_sessions,
          (SELECT count(*) FROM runs)                                          AS total_runs,
          (SELECT count(*) FROM documents)                                     AS total_documents,
          (SELECT count(*) FROM papers)                                        AS total_papers,
          (SELECT count(*) FROM runs WHERE status = 'running')                 AS runs_running,
          (SELECT count(*) FROM runs WHERE status = 'failed')                  AS runs_failed
        """
    )

    # Last 14 days, zero-filled, so the bars never collapse to a couple of
    # spikes with gaps between them.
    signups = await fetch_all(
        """
        SELECT to_char(d.day, 'DD Mon') AS label,
               count(u.id)              AS value
          FROM generate_series(
                 date_trunc('day', now()) - interval '13 days',
                 date_trunc('day', now()),
                 interval '1 day') AS d(day)
          LEFT JOIN "user" u
            ON date_trunc('day', u."createdAt") = d.day
         GROUP BY d.day
         ORDER BY d.day
        """
    )

    runs_daily = await fetch_all(
        """
        SELECT to_char(d.day, 'DD Mon') AS label,
               count(r.id)              AS value
          FROM generate_series(
                 date_trunc('day', now()) - interval '13 days',
                 date_trunc('day', now()),
                 interval '1 day') AS d(day)
          LEFT JOIN runs r ON date_trunc('day', r.created_at) = d.day
         GROUP BY d.day
         ORDER BY d.day
        """
    )

    # Users with no row in llm_config have never opened the setting, and the
    # product treats that as managed Fiberarticle AI. Counting them as such
    # keeps this chart's total equal to the number of users.
    by_mode = await fetch_all(
        """
        SELECT COALESCE(c.mode, 'fiberarticle_ai') AS label,
               count(*)                            AS value
          FROM "user" u
          LEFT JOIN llm_config c ON c.user_id = u.id
         GROUP BY 1
         ORDER BY 2 DESC
        """
    )

    by_status = await fetch_all(
        "SELECT status AS label, count(*) AS value FROM runs GROUP BY 1 ORDER BY 2 DESC"
    )

    total_users = int(totals["total_users"])
    verified = int(totals["verified_users"])

    return Overview(
        total_users=total_users,
        verified_users=verified,
        unverified_users=total_users - verified,
        admin_users=int(totals["admin_users"]),
        users_with_live_session=int(totals["live_sessions"]),
        total_runs=int(totals["total_runs"]),
        total_documents=int(totals["total_documents"]),
        total_papers=int(totals["total_papers"]),
        runs_running=int(totals["runs_running"]),
        runs_failed=int(totals["runs_failed"]),
        signups_by_day=[CountPoint(**r) for r in signups],
        users_by_ai_mode=[CountPoint(**r) for r in by_mode],
        runs_by_day=[CountPoint(**r) for r in runs_daily],
        runs_by_status=[CountPoint(**r) for r in by_status],
    )


# ---------------------------------------------------------------- users


@router.get("/users", response_model=AdminUserList)
async def list_users(
    admin_id: str = AdminUser,
    search: str = Query(default="", max_length=200),
    sort: Literal["newest", "oldest", "name", "email", "runs"] = "newest",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> AdminUserList:
    order = {
        "newest": 'u."createdAt" DESC',
        "oldest": 'u."createdAt" ASC',
        "name": "lower(u.name) ASC",
        "email": "lower(u.email) ASC",
        "runs": "run_count DESC",
    }[sort]

    # Parameterised, never formatted into the SQL: search text is user input.
    where = ""
    params: list = []
    if search.strip():
        where = " WHERE u.name ILIKE %s OR u.email ILIKE %s"
        like = f"%{search.strip()}%"
        params = [like, like]

    total_row = await fetch_one(
        f'SELECT count(*) AS n FROM "user" u{where}', *params
    )
    rows = await fetch_all(
        f"{_USER_SELECT}{where} ORDER BY {order} LIMIT %s OFFSET %s",
        *params,
        limit,
        offset,
    )
    return AdminUserList(
        users=[_row_to_user(r) for r in rows],
        total=int(total_row["n"]),
    )


@router.get("/users/{user_id}", response_model=UserDetail)
async def user_detail(user_id: str, admin_id: str = AdminUser) -> UserDetail:
    rows = await fetch_all(f"{_USER_SELECT} WHERE u.id = %s", user_id)
    if not rows:
        raise HTTPException(status_code=404, detail="No such user")

    sessions = await fetch_all(
        """
        SELECT id, "createdAt", "expiresAt", "ipAddress", "userAgent",
               ("expiresAt" > now()) AS live
          FROM "session"
         WHERE "userId" = %s
         ORDER BY "createdAt" DESC
         LIMIT 50
        """,
        user_id,
    )
    accounts = await fetch_all(
        """
        SELECT id, "providerId", "createdAt", (password IS NOT NULL) AS has_password
          FROM "account"
         WHERE "userId" = %s
         ORDER BY "createdAt"
        """,
        user_id,
    )

    work = await fetch_all(
        """
        SELECT id::text, 'Research'::text AS kind, topic AS title, status, created_at
          FROM runs WHERE user_id = %s
        UNION ALL
        SELECT id::text, 'Article', COALESCE(title, 'Untitled'), status, created_at
          FROM documents WHERE user_id = %s
        UNION ALL
        SELECT id::text, 'Table', name, status, created_at
          FROM extractions WHERE user_id = %s
        UNION ALL
        SELECT id::text, 'Chat', COALESCE(title, 'Untitled'), NULL, created_at
          FROM conversations WHERE user_id = %s
        ORDER BY created_at DESC
        LIMIT 200
        """,
        user_id,
        user_id,
        user_id,
        user_id,
    )

    return UserDetail(
        user=_row_to_user(rows[0]),
        sessions=[dict(s) for s in sessions],
        accounts=[dict(a) for a in accounts],
        work=[
            WorkItem(
                id=w["id"],
                kind=w["kind"],
                title=w["title"] or "Untitled",
                status=w["status"],
                created_at=w["created_at"],
            )
            for w in work
        ],
    )


@router.patch("/users/{user_id}", response_model=Ok)
async def update_user(
    user_id: str, body: UserPatch, admin_id: str = AdminUser
) -> Ok:
    await _require_user(user_id)

    # An admin removing their own admin rights could leave the system with
    # nobody able to reach this page, and there would then be no way back in
    # through the product at all. Refuse it rather than let it happen.
    if body.role is not None and user_id == admin_id and body.role != "admin":
        raise HTTPException(
            status_code=400,
            detail="You cannot remove your own admin access. Ask another admin to do it.",
        )

    sets: list[str] = []
    params: list = []
    if body.name is not None:
        sets.append("name = %s")
        params.append(body.name.strip())
    if body.email is not None:
        email = body.email.strip().lower()
        if not _EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="That does not look like an email address")
        clash = await fetch_one(
            'SELECT id FROM "user" WHERE lower(email) = %s AND id <> %s',
            email,
            user_id,
        )
        if clash:
            raise HTTPException(
                status_code=409, detail="Another account already uses that email"
            )
        sets.append("email = %s")
        params.append(email)
    if body.email_verified is not None:
        sets.append('"emailVerified" = %s')
        params.append(body.email_verified)
    if body.role is not None:
        sets.append("role = %s")
        params.append(body.role)

    if not sets:
        return Ok(message="Nothing to change")

    sets.append('"updatedAt" = now()')
    params.append(user_id)
    await execute(f'UPDATE "user" SET {", ".join(sets)} WHERE id = %s', *params)

    # Taking admin away has to bite straight away. The role lives inside
    # already-issued tokens, so without clearing their sessions the person
    # would keep admin until their current token expired.
    if body.role == "user":
        await execute('DELETE FROM "session" WHERE "userId" = %s', user_id)
        return Ok(message="Saved. They were signed out so the change applies at once.")

    return Ok(message="Saved")


@router.post("/users/{user_id}/sign-out", response_model=Ok)
async def sign_out_user(user_id: str, admin_id: str = AdminUser) -> Ok:
    await _require_user(user_id)
    await execute('DELETE FROM "session" WHERE "userId" = %s', user_id)
    return Ok(message="Signed out of every device")


@router.delete("/users/{user_id}", response_model=Ok)
async def delete_user(user_id: str, admin_id: str = AdminUser) -> Ok:
    """
    Remove the account and everything it owns.

    Better Auth's own tables cascade from "user", but this API's tables do not,
    because they hold the user id as plain text with no foreign key. So every
    one of them is cleared here as well. All of it runs inside one transaction:
    a half-deleted account that still owns papers would be worse than either
    outcome.
    """
    await _require_user(user_id)
    if user_id == admin_id:
        raise HTTPException(
            status_code=400,
            detail="You cannot delete your own account from here.",
        )

    async with get_pool().connection() as conn:
        async with conn.transaction():
            for table in USER_OWNED_TABLES:
                await conn.execute(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))
            await conn.execute('DELETE FROM "session" WHERE "userId" = %s', (user_id,))
            await conn.execute('DELETE FROM "account" WHERE "userId" = %s', (user_id,))
            await conn.execute('DELETE FROM "user" WHERE id = %s', (user_id,))

    return Ok(message="Account and all of its work deleted")


# ---------------------------------------------------------------- AI setup


@router.patch("/users/{user_id}/ai", response_model=Ok)
async def update_ai(user_id: str, body: AiPatch, admin_id: str = AdminUser) -> Ok:
    """
    Change which AI a user runs on.

    There is no way to set a key from here on purpose. Keys are write-only from
    the person's own settings page, and an admin has no business typing someone
    else's key in. The existing key is left untouched by this call.
    """
    await _require_user(user_id)
    if body.mode not in CAPS:
        raise HTTPException(status_code=400, detail="Unknown AI mode")

    await execute(
        """
        INSERT INTO llm_config (user_id, mode, provider, model, base_url, reasoning)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (user_id) DO UPDATE
           SET mode = EXCLUDED.mode,
               provider = EXCLUDED.provider,
               model = EXCLUDED.model,
               base_url = EXCLUDED.base_url,
               reasoning = EXCLUDED.reasoning,
               updated_at = now()
        """,
        user_id,
        body.mode,
        body.provider,
        body.model,
        body.base_url,
        body.reasoning,
    )
    return Ok(message="AI setup saved")


@router.delete("/users/{user_id}/ai-key", response_model=Ok)
async def delete_ai_key(user_id: str, admin_id: str = AdminUser) -> Ok:
    await _require_user(user_id)
    await execute(
        "UPDATE llm_config SET encrypted_key = NULL, updated_at = now() WHERE user_id = %s",
        user_id,
    )
    return Ok(message="Saved key removed")


# ---------------------------------------------------------------- their work


_WORK_TABLES = {
    "run": "runs",
    "document": "documents",
    "extraction": "extractions",
    "conversation": "conversations",
}


@router.delete("/work/{kind}/{item_id}", response_model=Ok)
async def delete_work(kind: str, item_id: str, admin_id: str = AdminUser) -> Ok:
    """Delete one piece of a user's work. kind is looked up in a fixed map, so
    no caller-supplied text ever reaches the SQL as a table name."""
    table = _WORK_TABLES.get(kind)
    if table is None:
        raise HTTPException(status_code=404, detail="Unknown item type")

    # Children first, for the two that own rows in other tables.
    async with get_pool().connection() as conn:
        async with conn.transaction():
            if table == "runs":
                await conn.execute("DELETE FROM chunks WHERE run_id = %s", (item_id,))
                await conn.execute("DELETE FROM papers WHERE run_id = %s", (item_id,))
                await conn.execute(
                    "DELETE FROM run_events WHERE run_id = %s", (item_id,)
                )
                await conn.execute(
                    "DELETE FROM documents WHERE run_id = %s", (item_id,)
                )
            if table == "conversations":
                await conn.execute(
                    "DELETE FROM chat_messages WHERE conversation_id = %s", (item_id,)
                )
            cur = await conn.execute(
                f"DELETE FROM {table} WHERE id = %s", (item_id,)
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Already gone")

    return Ok(message="Deleted")
