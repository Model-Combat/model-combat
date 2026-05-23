from __future__ import annotations

from pathlib import Path

from sqlalchemy import event
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

from model_combat.config import Settings

Base = declarative_base()


def _ensure_sqlite_parent_dir(database_url: str) -> None:
    """For file-backed SQLite URLs, create the parent directory so the
    first `create_engine().connect()` doesn't fail with 'unable to open
    database file' just because the user ran us from a fresh checkout."""
    if not database_url.startswith("sqlite"):
        return
    # Strip dialect/driver prefix.
    after = database_url.split(":///", 1)[-1] if ":///" in database_url else ""
    if not after or after.startswith(":memory:") or after == "":
        return
    parent = Path(after).expanduser().parent
    if parent and str(parent) not in {"", "."}:
        parent.mkdir(parents=True, exist_ok=True)


def create_session_factory(settings: Settings) -> sessionmaker[Session]:
    _ensure_sqlite_parent_dir(settings.database_url)
    connect_args: dict = {}
    engine_kwargs: dict = {"future": True}
    if settings.database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        connect_args["timeout"] = 60
        if settings.database_url.endswith(":memory:") or settings.database_url.rstrip("/").endswith("/:memory:"):
            connect_args["uri"] = True
            engine_kwargs["poolclass"] = StaticPool
    engine = create_engine(settings.database_url, connect_args=connect_args, **engine_kwargs)
    if settings.database_url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _configure_sqlite(dbapi_connection, connection_record):  # type: ignore[no-redef]
            del connection_record
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("PRAGMA synchronous=NORMAL;")
            cursor.execute("PRAGMA busy_timeout=60000;")
            cursor.close()
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
