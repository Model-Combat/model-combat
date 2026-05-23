from __future__ import annotations

from collections.abc import Generator

from fastapi import Request
from sqlalchemy.orm import Session

from model_combat.checkers.executor import CheckerExecutor
from model_combat.config import Settings
from model_combat.domain.service import RoundManager
from model_combat.runtime.base import RuntimeAdapter


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db_session(request: Request) -> Generator[Session, None, None]:
    session_factory = request.app.state.session_factory
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


def get_runtime(request: Request) -> RuntimeAdapter:
    return request.app.state.runtime


def get_checker_executor(request: Request) -> CheckerExecutor:
    return request.app.state.checker_executor


def get_round_manager(request: Request, session: Session) -> RoundManager:
    return RoundManager(
        session=session,
        settings=request.app.state.settings,
        runtime=request.app.state.runtime,
        checker_executor=request.app.state.checker_executor,
    )
