from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from model_combat.api.deps import get_db_session
from model_combat.api.schemas import FlagSubmissionRequest, FlagSubmissionResponse
from model_combat.domain.service import RoundManager

router = APIRouter(prefix="/flags", tags=["flags"])


@router.post("/submit", response_model=FlagSubmissionResponse)
def submit_flag(payload: FlagSubmissionRequest, request: Request, session: Session = Depends(get_db_session)) -> FlagSubmissionResponse:
    manager = RoundManager(
        session=session,
        settings=request.app.state.settings,
        runtime=request.app.state.runtime,
        checker_executor=request.app.state.checker_executor,
    )
    try:
        return manager.submit_flag(payload.team_id, payload.flag)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
