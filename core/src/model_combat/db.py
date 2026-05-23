from __future__ import annotations

from sqlalchemy import event
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

from model_combat.config import Settings

Base = declarative_base()


def create_session_factory(settings: Settings) -> sessionmaker[Session]:
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
