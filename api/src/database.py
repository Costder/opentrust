"""Database abstraction: Turso HTTP API in production, aiosqlite for local dev.

Set TURSO_URL + TURSO_AUTH_TOKEN env vars to use Turso.
Leave both unset to use a local SQLite file (dev / CI).
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import aiosqlite
import httpx

from .config import settings

# ─── Schema ──────────────────────────────────────────────────────────────────

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS passports (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    trust_status TEXT NOT NULL DEFAULT 'auto_generated_draft',
    tool_identity TEXT NOT NULL,
    creator_identity TEXT,
    version_hash TEXT NOT NULL,
    capabilities TEXT NOT NULL,
    permission_manifest TEXT NOT NULL,
    evidence TEXT,
    risk_summary TEXT,
    review_history TEXT NOT NULL DEFAULT '[]',
    commercial_status TEXT NOT NULL,
    billing_plan TEXT,
    fee_schedule TEXT,
    agent_access TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
"""

_OBJECTS_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS marketplace_objects (
    kind TEXT NOT NULL,
    obj_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (kind, obj_id)
);
"""

_COLUMNS = [
    "id", "slug", "name", "description", "trust_status",
    "tool_identity", "creator_identity", "version_hash", "capabilities",
    "permission_manifest", "evidence", "risk_summary", "review_history",
    "commercial_status", "billing_plan", "fee_schedule", "agent_access",
    "created_at", "updated_at",
]

_JSON_COLS = frozenset({
    "tool_identity", "creator_identity", "version_hash", "capabilities",
    "permission_manifest", "evidence", "risk_summary", "review_history",
    "commercial_status", "billing_plan", "fee_schedule", "agent_access",
})


# ─── PassportRow ─────────────────────────────────────────────────────────────

class PassportRow:
    """Attribute-accessible passport row; compatible with PassportRead.from_model()."""

    def __init__(self, row: tuple | list) -> None:
        for col, val in zip(_COLUMNS, row):
            if col in _JSON_COLS and isinstance(val, str) and val:
                try:
                    val = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    pass
            setattr(self, col, val)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _serialize(col: str, val: Any) -> Any:
    if col in _JSON_COLS:
        if hasattr(val, "model_dump"):
            # Pydantic v2 BaseModel — serialise to dict then JSON
            return json.dumps(val.model_dump())
        if isinstance(val, (dict, list)):
            return json.dumps(val)
    return val


def _turso_arg(val: Any) -> dict:
    if val is None:
        return {"type": "null"}
    return {"type": "text", "value": str(val)}


def _turso_cell(cell: dict) -> Any:
    t = cell["type"]
    if t == "null":
        return None
    v = cell.get("value", "")
    if t == "integer":
        return int(v)
    if t == "real":
        return float(v)
    return v


# ─── Database ────────────────────────────────────────────────────────────────

class Database:
    """Async DB wrapper. Uses Turso HTTP API when TURSO_URL is set, aiosqlite otherwise."""

    def __init__(self) -> None:
        url = settings.turso_url.rstrip("/")
        # Turso gives a libsql:// URL; the HTTP pipeline API needs https://
        self._turso_url = url.replace("libsql://", "https://", 1)
        self._turso_token = settings.turso_auth_token
        self._sqlite_path = settings.sqlite_path

    @property
    def _use_turso(self) -> bool:
        return bool(self._turso_url and self._turso_token)

    # ── Core execute ─────────────────────────────────────────────────────────

    async def _execute(self, sql: str, args: list[Any] | None = None) -> list[PassportRow]:
        if self._use_turso:
            return await self._turso_execute(sql, args)
        return await self._sqlite_execute(sql, args)

    async def _turso_execute(self, sql: str, args: list[Any] | None) -> list[PassportRow]:
        stmt: dict = {"sql": sql}
        if args:
            stmt["args"] = [_turso_arg(a) for a in args]
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{self._turso_url}/v2/pipeline",
                headers={
                    "Authorization": f"Bearer {self._turso_token}",
                    "Content-Type": "application/json",
                },
                json={"requests": [{"type": "execute", "stmt": stmt}, {"type": "close"}]},
            )
            resp.raise_for_status()

        data = resp.json()
        result = data["results"][0]
        if result.get("type") != "ok":
            raise RuntimeError(f"Turso error: {result}")

        execute_result = result["response"]["result"]
        if not execute_result.get("cols"):
            return []

        col_names = [c["name"] for c in execute_result["cols"]]
        rows = []
        for raw_row in execute_result["rows"]:
            values = [_turso_cell(cell) for cell in raw_row]
            col_map = dict(zip(col_names, values))
            ordered = [col_map.get(c) for c in _COLUMNS]
            rows.append(PassportRow(ordered))
        return rows

    async def _sqlite_execute(self, sql: str, args: list[Any] | None) -> list[PassportRow]:
        async with aiosqlite.connect(self._sqlite_path) as conn:
            cur = await conn.execute(sql, args or [])
            await conn.commit()
            if cur.description is None:
                return []
            rows = await cur.fetchall()
            return [PassportRow(row) for row in rows]

    # ── Schema init ──────────────────────────────────────────────────────────

    async def init(self) -> None:
        await self._execute(_SCHEMA_SQL)
        await self._execute(_OBJECTS_SCHEMA_SQL)
        # Additive migrations: add columns introduced after v0.1 if missing.
        # SQLite and Turso both ignore errors for existing columns.
        for migration in [
            "ALTER TABLE passports ADD COLUMN evidence TEXT",
        ]:
            try:
                await self._execute(migration)
            except Exception:
                pass  # Column already exists — that's fine.

    # ── Generic object persistence ─────────────────────────────────────────────
    # A small key/value-by-kind table backs durable marketplace state (listings,
    # orders, …) so the catalog survives process restarts / serverless cold
    # starts. Values are JSON blobs; the in-memory store remains the working set.

    async def _execute_raw(self, sql: str, args: list[Any] | None = None) -> list[dict]:
        """Execute returning raw column->value dicts (not PassportRow-shaped)."""
        if self._use_turso:
            return await self._turso_execute_raw(sql, args)
        return await self._sqlite_execute_raw(sql, args)

    async def _sqlite_execute_raw(self, sql: str, args: list[Any] | None) -> list[dict]:
        async with aiosqlite.connect(self._sqlite_path) as conn:
            conn.row_factory = aiosqlite.Row
            cur = await conn.execute(sql, args or [])
            await conn.commit()
            if cur.description is None:
                return []
            rows = await cur.fetchall()
            return [dict(r) for r in rows]

    async def _turso_execute_raw(self, sql: str, args: list[Any] | None) -> list[dict]:
        stmt: dict = {"sql": sql}
        if args:
            stmt["args"] = [_turso_arg(a) for a in args]
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{self._turso_url}/v2/pipeline",
                headers={
                    "Authorization": f"Bearer {self._turso_token}",
                    "Content-Type": "application/json",
                },
                json={"requests": [{"type": "execute", "stmt": stmt}, {"type": "close"}]},
            )
            resp.raise_for_status()
        result = resp.json()["results"][0]
        if result.get("type") != "ok":
            raise RuntimeError(f"Turso error: {result}")
        execute_result = result["response"]["result"]
        if not execute_result.get("cols"):
            return []
        col_names = [c["name"] for c in execute_result["cols"]]
        out = []
        for raw_row in execute_result["rows"]:
            values = [_turso_cell(cell) for cell in raw_row]
            out.append(dict(zip(col_names, values)))
        return out

    async def _ensure_objects_table(self) -> None:
        """Create the objects table if a pre-existing DB predates it (migration-safe)."""
        await self._execute_raw(_OBJECTS_SCHEMA_SQL)

    async def save_object(self, kind: str, obj_id: str, data: dict) -> None:
        """Insert-or-replace a JSON object under (kind, obj_id)."""
        await self._ensure_objects_table()
        await self._execute_raw(
            "INSERT INTO marketplace_objects (kind, obj_id, data, updated_at) "
            "VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now')) "
            "ON CONFLICT(kind, obj_id) DO UPDATE SET data=excluded.data, "
            "updated_at=excluded.updated_at",
            [kind, obj_id, json.dumps(data)],
        )

    async def load_objects(self, kind: str) -> list[dict]:
        """Return all stored objects of a kind, newest first."""
        await self._ensure_objects_table()
        rows = await self._execute_raw(
            "SELECT data FROM marketplace_objects WHERE kind = ? ORDER BY updated_at DESC, obj_id",
            [kind],
        )
        return [json.loads(r["data"]) for r in rows]

    async def get_object(self, kind: str, obj_id: str) -> dict | None:
        rows = await self._execute_raw(
            "SELECT data FROM marketplace_objects WHERE kind = ? AND obj_id = ?",
            [kind, obj_id],
        )
        return json.loads(rows[0]["data"]) if rows else None

    async def delete_object(self, kind: str, obj_id: str) -> None:
        await self._execute_raw(
            "DELETE FROM marketplace_objects WHERE kind = ? AND obj_id = ?",
            [kind, obj_id],
        )

    # ── Query methods ─────────────────────────────────────────────────────────

    async def list_passports(self) -> list[PassportRow]:
        cols = ", ".join(_COLUMNS)
        return await self._execute(f"SELECT {cols} FROM passports ORDER BY name")

    async def list_filtered(
        self,
        q: str | None = None,
        trust_status: str | None = None,
        offset: int = 0,
        limit: int = 20,
    ) -> list[PassportRow]:
        cols = ", ".join(_COLUMNS)
        conditions: list[str] = []
        args: list[Any] = []
        if q:
            like = f"%{q}%"
            conditions.append("(name LIKE ? OR description LIKE ? OR capabilities LIKE ?)")
            args.extend([like, like, like])
        if trust_status:
            conditions.append("trust_status = ?")
            args.append(trust_status)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        args.extend([limit, offset])
        return await self._execute(
            f"SELECT {cols} FROM passports {where} ORDER BY name LIMIT ? OFFSET ?",
            args,
        )

    async def count_filtered(
        self,
        q: str | None = None,
        trust_status: str | None = None,
    ) -> int:
        """Return total row count matching filters (fetches all matching rows)."""
        rows = await self.list_filtered(q, trust_status, offset=0, limit=99999)
        return len(rows)

    async def get_by_slug(self, slug: str) -> PassportRow | None:
        cols = ", ".join(_COLUMNS)
        rows = await self._execute(
            f"SELECT {cols} FROM passports WHERE slug = ?", [slug]
        )
        return rows[0] if rows else None

    async def search(self, q: str) -> list[PassportRow]:
        like = f"%{q}%"
        cols = ", ".join(_COLUMNS)
        return await self._execute(
            f"SELECT {cols} FROM passports"
            " WHERE name LIKE ? OR description LIKE ? OR capabilities LIKE ?",
            [like, like, like],
        )

    async def create(self, data: dict) -> PassportRow:
        cols = list(data.keys())
        vals = [_serialize(c, data[c]) for c in cols]
        placeholders = ", ".join("?" * len(cols))
        await self._execute(
            f"INSERT INTO passports ({', '.join(cols)}) VALUES ({placeholders})", vals
        )
        return await self.get_by_slug(data["slug"])

    async def update(self, slug: str, data: dict) -> PassportRow:
        writable = {c: v for c, v in data.items() if c not in ("id", "slug")}
        sets = ", ".join(f"{c} = ?" for c in writable)
        sets += ", updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
        vals = [_serialize(c, v) for c, v in writable.items()]
        vals.append(slug)
        await self._execute(f"UPDATE passports SET {sets} WHERE slug = ?", vals)
        return await self.get_by_slug(slug)


# ─── Singleton + FastAPI dependency ──────────────────────────────────────────

db = Database()


async def get_db() -> AsyncIterator[Database]:
    yield db
