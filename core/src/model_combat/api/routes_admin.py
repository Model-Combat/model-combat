from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from model_combat.agents.match import MatchOrchestrator
from model_combat.api.deps import get_db_session
from model_combat.api.schemas import (
    ArtifactResponse,
    CheckerRunResponse,
    DatasetArtifactCreate,
    MatchRunResponse,
    RoundCreateRequest,
    RoundStateResponse,
    ScoreEventResponse,
    TrajectoryAuditEventResponse,
    TrajectoryAuditResponse,
)
from model_combat.artifacts.loader import ArtifactLoader
from model_combat.domain.service import RoundManager
from model_combat.domain.trajectory_audit import TrajectoryAuditResult, audit_trace_rows
from model_combat.storage.models import DatasetArtifact, TeamTrace
from sqlalchemy import select

router = APIRouter(prefix="/admin", tags=["admin"])


def _round_manager(request: Request, session: Session) -> RoundManager:
    return RoundManager(
        session=session,
        settings=request.app.state.settings,
        runtime=request.app.state.runtime,
        checker_executor=request.app.state.checker_executor,
    )


@router.post("/artifacts/sync")
def sync_artifacts(request: Request, session: Session = Depends(get_db_session)) -> dict:
    loader = ArtifactLoader(request.app.state.settings.artifacts_root)
    count = loader.sync_to_db(session)
    return {"synced": count}


@router.post("/artifacts", response_model=ArtifactResponse)
def create_artifact(payload: DatasetArtifactCreate, request: Request, session: Session = Depends(get_db_session)) -> ArtifactResponse:
    manager = _round_manager(request, session)
    artifact = manager.register_artifact(
        DatasetArtifact(
            id=payload.artifact_id,
            service_id=payload.service_id,
            display_name=payload.display_name,
            repo_url=payload.repo_url,
            pinned_commit=payload.pinned_commit,
            clean_repo_bundle=payload.clean_repo_bundle,
            vuln_repo_bundle=payload.vuln_repo_bundle,
            runtime_spec=payload.runtime_spec.model_dump(mode="json"),
            flag_spec=payload.flag_spec,
            seed_metadata=payload.seed_metadata,
            checker_paths=payload.checker_paths,
            reference_patch=payload.reference_patch,
            wave_variants=[variant.model_dump(mode="json") for variant in payload.wave_variants],
            active=payload.active,
        )
    )
    return ArtifactResponse(
        artifact_id=artifact.id,
        service_id=artifact.service_id,
        display_name=artifact.display_name,
        repo_url=artifact.repo_url,
        pinned_commit=artifact.pinned_commit,
        active=artifact.active,
    )


@router.get("/artifacts", response_model=list[ArtifactResponse])
def list_artifacts(request: Request, session: Session = Depends(get_db_session)) -> list[ArtifactResponse]:
    manager = _round_manager(request, session)
    return [
        ArtifactResponse(
            artifact_id=artifact.id,
            service_id=artifact.service_id,
            display_name=artifact.display_name,
            repo_url=artifact.repo_url,
            pinned_commit=artifact.pinned_commit,
            active=artifact.active,
        )
        for artifact in manager.list_active_artifacts()
    ]


@router.post("/rounds", response_model=RoundStateResponse)
def create_round(payload: RoundCreateRequest, request: Request, session: Session = Depends(get_db_session)) -> RoundStateResponse:
    manager = _round_manager(request, session)
    try:
        round_obj = manager.create_round(payload)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return _to_round_response(round_obj, manager)


@router.get("/rounds/{round_id}", response_model=RoundStateResponse)
def get_round(round_id: str, request: Request, session: Session = Depends(get_db_session)) -> RoundStateResponse:
    manager = _round_manager(request, session)
    try:
        round_obj = manager.get_round(round_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return _to_round_response(round_obj, manager)


@router.post("/rounds/{round_id}/provision", response_model=RoundStateResponse)
def provision_round(round_id: str, request: Request, session: Session = Depends(get_db_session)) -> RoundStateResponse:
    manager = _round_manager(request, session)
    try:
        round_obj = manager.provision_round(round_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return _to_round_response(round_obj, manager)


@router.post("/rounds/{round_id}/start", response_model=RoundStateResponse)
def start_round(round_id: str, request: Request, session: Session = Depends(get_db_session)) -> RoundStateResponse:
    manager = _round_manager(request, session)
    try:
        round_obj = manager.start_round(round_id)
        if request.app.state.settings.scheduler_enabled:
            request.app.state.scheduler_service.schedule_round(round_id, round_obj.wave_duration_seconds)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return _to_round_response(round_obj, manager)


@router.post("/rounds/{round_id}/pause", response_model=RoundStateResponse)
def pause_round(round_id: str, request: Request, session: Session = Depends(get_db_session)) -> RoundStateResponse:
    manager = _round_manager(request, session)
    try:
        round_obj = manager.pause_round(round_id)
        request.app.state.scheduler_service.unschedule_round(round_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return _to_round_response(round_obj, manager)


@router.post("/rounds/{round_id}/abort", response_model=RoundStateResponse)
def abort_round(round_id: str, request: Request, session: Session = Depends(get_db_session)) -> RoundStateResponse:
    manager = _round_manager(request, session)
    try:
        round_obj = manager.abort_round(round_id)
        request.app.state.scheduler_service.unschedule_round(round_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return _to_round_response(round_obj, manager)


@router.post("/rounds/{round_id}/finalize", response_model=RoundStateResponse)
def finalize_round(round_id: str, request: Request, session: Session = Depends(get_db_session)) -> RoundStateResponse:
    manager = _round_manager(request, session)
    try:
        round_obj = manager.finalize_round(round_id)
        request.app.state.scheduler_service.unschedule_round(round_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return _to_round_response(round_obj, manager)


@router.post("/rounds/{round_id}/advance-wave", response_model=RoundStateResponse)
def advance_wave(round_id: str, request: Request, session: Session = Depends(get_db_session)) -> RoundStateResponse:
    manager = _round_manager(request, session)
    try:
        round_obj = manager.advance_round_wave(round_id)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return _to_round_response(round_obj, manager)


@router.post("/rounds/{round_id}/health-checks")
def run_health_checks(round_id: str, request: Request, session: Session = Depends(get_db_session)) -> dict:
    manager = _round_manager(request, session)
    try:
        manager.run_health_checks(round_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"round_id": round_id, "status": "ok"}


@router.post("/rounds/{round_id}/patch-checks")
def run_patch_checks(round_id: str, request: Request, session: Session = Depends(get_db_session)) -> dict:
    manager = _round_manager(request, session)
    try:
        manager.run_patch_checks(round_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"round_id": round_id, "status": "ok"}


@router.get("/rounds/{round_id}/score-events", response_model=list[ScoreEventResponse])
def score_events(round_id: str, request: Request, session: Session = Depends(get_db_session)) -> list[ScoreEventResponse]:
    manager = _round_manager(request, session)
    try:
        events = manager.score_events(round_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return [
        ScoreEventResponse(
            event_id=event.id,
            team_id=event.team_id,
            service_id=event.service_id,
            wave=event.wave,
            type=event.type.value,
            delta=event.delta,
            related_team_id=event.related_team_id,
            created_at=event.created_at,
        )
        for event in events
    ]


@router.get("/rounds/{round_id}/traces")
def traces(
    round_id: str,
    request: Request,
    session: Session = Depends(get_db_session),
    team_id: str | None = None,
    since_id: str | None = None,
    limit: int = 500,
) -> list[dict]:
    del request
    stmt = select(TeamTrace).where(TeamTrace.round_id == round_id)
    if team_id is not None:
        stmt = stmt.where(TeamTrace.team_id == team_id)
    if since_id is not None:
        stmt = stmt.where(TeamTrace.id > since_id)
    stmt = stmt.order_by(TeamTrace.created_at.asc(), TeamTrace.id.asc()).limit(limit)
    rows = list(session.scalars(stmt))
    return [
        {
            "trace_id": r.id,
            "team_id": r.team_id,
            "phase": r.phase,
            "event_type": r.event_type,
            "payload": r.payload,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.get("/rounds/{round_id}/trajectory-audit", response_model=TrajectoryAuditResponse)
def trajectory_audit(
    round_id: str,
    request: Request,
    session: Session = Depends(get_db_session),
    team_id: str | None = None,
    limit: int = 1000,
) -> TrajectoryAuditResponse:
    manager = _round_manager(request, session)
    try:
        manager.get_round(round_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    stmt = select(TeamTrace).where(TeamTrace.round_id == round_id)
    if team_id is not None:
        stmt = stmt.where(TeamTrace.team_id == team_id)
    stmt = stmt.order_by(TeamTrace.created_at.asc(), TeamTrace.id.asc()).limit(limit)
    return _to_trajectory_audit_response(audit_trace_rows(session.scalars(stmt)))


@router.get("/rounds/{round_id}/checker-runs", response_model=list[CheckerRunResponse])
def checker_runs(round_id: str, request: Request, session: Session = Depends(get_db_session)) -> list[CheckerRunResponse]:
    manager = _round_manager(request, session)
    try:
        runs = manager.checker_runs(round_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return [
        CheckerRunResponse(
            checker_run_id=run.id,
            team_id=run.team_id,
            service_id=run.service_id,
            kind=run.kind.value,
            success=run.success,
            exit_code=run.exit_code,
            started_at=run.started_at,
            finished_at=run.finished_at,
        )
        for run in runs
    ]


@router.post("/rounds/{round_id}/run-match", response_model=MatchRunResponse)
def run_match(
    round_id: str,
    request: Request,
    left_provider: str = "anthropic",
    right_provider: str = "anthropic",
    left_model: str | None = None,
    right_model: str | None = None,
    left_reasoning: str | None = None,
    right_reasoning: str | None = None,
) -> MatchRunResponse:
    orchestrator = MatchOrchestrator(
        session_factory=request.app.state.session_factory,
        settings=request.app.state.settings,
        runtime=request.app.state.runtime,
        checker_executor=request.app.state.checker_executor,
        scheduler_service=request.app.state.scheduler_service,
    )
    try:
        result = orchestrator.run_match(
            round_id=round_id,
            left_provider=left_provider,
            right_provider=right_provider,
            left_model=left_model,
            right_model=right_model,
            left_reasoning=left_reasoning,
            right_reasoning=right_reasoning,
        )
    except (KeyError, ValueError, RuntimeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return MatchRunResponse(**result)


def _to_round_response(round_obj, manager: RoundManager) -> RoundStateResponse:
    services = manager.get_round_services(round_obj.id)
    return RoundStateResponse(
        round_id=round_obj.id,
        status=round_obj.status.value,
        current_wave=round_obj.current_wave,
        round_duration_seconds=round_obj.round_duration_seconds,
        wave_duration_seconds=round_obj.wave_duration_seconds,
        started_at=round_obj.started_at,
        ended_at=round_obj.ended_at,
        service_ids=[service.artifact.service_id for service in services],
        team_ids=[team.id for team in round_obj.teams],
    )


def _to_trajectory_audit_response(result: TrajectoryAuditResult) -> TrajectoryAuditResponse:
    return TrajectoryAuditResponse(
        ok=result.ok,
        trace_count=result.trace_count,
        forbidden_event_count=result.forbidden_event_count,
        forbidden_events=[
            TrajectoryAuditEventResponse(
                trace_id=event.trace_id,
                team_id=event.team_id,
                phase=event.phase,
                event_type=event.event_type,
                source=event.source,
                markers=event.markers,
                arguments=event.arguments,
            )
            for event in result.forbidden_events
        ],
        checked_markers=list(result.checked_markers),
    )
