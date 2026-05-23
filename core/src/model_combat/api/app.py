from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from model_combat.api.routes_admin import router as admin_router
from model_combat.api.routes_flags import router as flags_router
from model_combat.api.routes_team import router as team_router
from model_combat.artifacts.loader import ArtifactLoader
from model_combat.checkers.executor import CheckerExecutor
from model_combat.config import get_settings
from model_combat.db import create_session_factory
from model_combat.runtime.docker_runtime import DockerRuntime
from model_combat.runtime.noop_runtime import NoopRuntime
from model_combat.runtime.process_runtime import ProcessRuntime
from model_combat.scheduler.service import SchedulerService


def create_app() -> FastAPI:
    settings = get_settings()
    settings.workspace_root = settings.workspace_root.resolve()
    settings.artifacts_root = settings.artifacts_root.resolve()
    session_factory = create_session_factory(settings)
    if settings.runtime_backend == "process":
        runtime = ProcessRuntime(settings)
    elif settings.runtime_backend == "noop":
        runtime = NoopRuntime()
    elif settings.runtime_backend == "docker" or settings.docker_enabled:
        runtime = DockerRuntime(settings)
    else:
        runtime = ProcessRuntime(settings)
    checker_executor = CheckerExecutor()
    startup_session = session_factory()
    try:
        ArtifactLoader(settings.artifacts_root).sync_to_db(startup_session)
    finally:
        startup_session.close()

    def build_round_manager():
        from model_combat.domain.service import RoundManager

        return RoundManager(
            session=session_factory(),
            settings=settings,
            runtime=runtime,
            checker_executor=checker_executor,
        )

    scheduler_service = SchedulerService(build_round_manager)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        session = session_factory()
        try:
            ArtifactLoader(settings.artifacts_root).sync_to_db(session)
        finally:
            session.close()

        if settings.scheduler_enabled:
            scheduler_service.start()
        try:
            yield
        finally:
            scheduler_service.stop()

    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.runtime = runtime
    app.state.checker_executor = checker_executor
    app.state.scheduler_service = scheduler_service
    app.include_router(admin_router)
    app.include_router(team_router)
    app.include_router(flags_router)

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True}

    return app
