"""Durable persistence for marketplace listings + orders.

The in-memory MarketplaceStore is the working set, but listings and orders must
survive process restarts (serverless cold starts on Vercel). The Database gains a
generic object table; the marketplace routes write-through on create and read the
catalog straight from the DB so it is durable and correct across instances.
"""
import pytest

from api.src.database import Database


@pytest.fixture
async def db(tmp_path):
    from api.src.config import settings

    orig = (settings.turso_url, settings.turso_auth_token, settings.sqlite_path)
    settings.turso_url = ""
    settings.turso_auth_token = ""
    settings.sqlite_path = str(tmp_path / "persist.db")
    d = Database()
    await d.init()
    yield d
    settings.turso_url, settings.turso_auth_token, settings.sqlite_path = orig


async def test_save_and_load_object(db):
    await db.save_object("listing", "listing_1", {"listing_id": "listing_1", "title": "A Tool", "price_usdc": "5.00"})
    rows = await db.load_objects("listing")
    assert len(rows) == 1
    assert rows[0]["title"] == "A Tool"
    assert rows[0]["price_usdc"] == "5.00"


async def test_save_is_upsert(db):
    await db.save_object("listing", "listing_1", {"listing_id": "listing_1", "title": "Old"})
    await db.save_object("listing", "listing_1", {"listing_id": "listing_1", "title": "New"})
    rows = await db.load_objects("listing")
    assert len(rows) == 1
    assert rows[0]["title"] == "New"


async def test_kinds_are_isolated(db):
    await db.save_object("listing", "l1", {"listing_id": "l1"})
    await db.save_object("order", "o1", {"order_id": "o1"})
    assert len(await db.load_objects("listing")) == 1
    assert len(await db.load_objects("order")) == 1


async def test_get_object_by_id(db):
    await db.save_object("listing", "l1", {"listing_id": "l1", "title": "Findable"})
    got = await db.get_object("listing", "l1")
    assert got is not None
    assert got["title"] == "Findable"
    assert await db.get_object("listing", "nope") is None


async def test_delete_object(db):
    await db.save_object("listing", "l1", {"listing_id": "l1"})
    await db.delete_object("listing", "l1")
    assert await db.load_objects("listing") == []


async def test_objects_survive_new_database_instance(db, tmp_path):
    """A fresh Database pointed at the same file sees previously-saved objects.

    This is the cold-start guarantee: process restarts must not lose the catalog.
    """
    from api.src.config import settings

    await db.save_object("listing", "l1", {"listing_id": "l1", "title": "Durable"})
    # New instance, same sqlite file (settings still point at it inside the fixture)
    fresh = Database()
    await fresh.init()
    rows = await fresh.load_objects("listing")
    assert len(rows) == 1
    assert rows[0]["title"] == "Durable"
    _ = settings  # keep import used
