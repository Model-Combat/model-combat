from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from model_combat.api.deps import get_db_session
from fastapi.responses import PlainTextResponse

from model_combat.api.schemas import AgentLaunchResponse, AgentRunResponse, LeaderboardEntry, TeamBootstrapResponse, TeamBootstrapService, TeamBootstrapTarget, TeamServiceStatusResponse, WaveResponse
from model_combat.domain.service import RoundManager

router = APIRouter(tags=["team"])


def _round_manager(request: Request, session: Session) -> RoundManager:
    return RoundManager(
        session=session,
        settings=request.app.state.settings,
        runtime=request.app.state.runtime,
        checker_executor=request.app.state.checker_executor,
    )


@router.get("/team/bootstrap", response_model=TeamBootstrapResponse)
def team_bootstrap(request: Request, team_id: str = Query(...), session: Session = Depends(get_db_session)) -> TeamBootstrapResponse:
    manager = _round_manager(request, session)
    try:
        return manager.build_bootstrap(team_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/team/targets", response_model=list[TeamBootstrapTarget])
def team_targets(request: Request, team_id: str = Query(...), session: Session = Depends(get_db_session)) -> list[TeamBootstrapTarget]:
    manager = _round_manager(request, session)
    try:
        return manager.get_targets(team_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/team/services", response_model=list[TeamBootstrapService])
def team_services(request: Request, team_id: str = Query(...), session: Session = Depends(get_db_session)) -> list[TeamBootstrapService]:
    manager = _round_manager(request, session)
    try:
        return manager.get_team_services(team_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/team/service-status", response_model=TeamServiceStatusResponse)
def team_service_status(
    request: Request,
    team_id: str = Query(...),
    service_id: str = Query(...),
    session: Session = Depends(get_db_session),
) -> TeamServiceStatusResponse:
    manager = _round_manager(request, session)
    try:
        return manager.team_service_status(team_id, service_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/team/service-restart", response_model=TeamServiceStatusResponse)
def team_service_restart(
    request: Request,
    team_id: str = Query(...),
    service_id: str = Query(...),
    session: Session = Depends(get_db_session),
) -> TeamServiceStatusResponse:
    manager = _round_manager(request, session)
    try:
        return manager.restart_team_service(team_id, service_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/team/service-logs", response_class=PlainTextResponse)
def team_service_logs(
    request: Request,
    team_id: str = Query(...),
    service_id: str = Query(...),
    session: Session = Depends(get_db_session),
) -> str:
    manager = _round_manager(request, session)
    try:
        return manager.team_service_logs(team_id, service_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/team/agent-launch", response_model=AgentLaunchResponse)
def team_agent_launch(
    request: Request,
    team_id: str = Query(...),
    provider: str = Query(...),
    session: Session = Depends(get_db_session),
) -> AgentLaunchResponse:
    manager = _round_manager(request, session)
    try:
        return manager.build_agent_launch(team_id, provider)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/team/agent-run", response_model=AgentRunResponse)
def team_agent_run(
    request: Request,
    team_id: str = Query(...),
    provider: str = Query(...),
    session: Session = Depends(get_db_session),
) -> AgentRunResponse:
    manager = _round_manager(request, session)
    try:
        return manager.run_agent(team_id, provider)
    except (KeyError, ValueError, RuntimeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def leaderboard(request: Request, round_id: str = Query(...), session: Session = Depends(get_db_session)) -> list[LeaderboardEntry]:
    manager = _round_manager(request, session)
    try:
        rows = manager.leaderboard(round_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return [LeaderboardEntry(**row) for row in rows]


@router.get("/waves/current", response_model=WaveResponse)
def current_wave(request: Request, round_id: str = Query(...), session: Session = Depends(get_db_session)) -> WaveResponse:
    manager = _round_manager(request, session)
    try:
        row = manager.current_wave(round_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return WaveResponse(**row)
