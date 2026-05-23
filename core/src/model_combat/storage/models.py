from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from model_combat.db import Base


class RoundStatus(str, enum.Enum):
    draft = "draft"
    provisioned = "provisioned"
    running = "running"
    paused = "paused"
    aborted = "aborted"
    finalized = "finalized"


class TeamRole(str, enum.Enum):
    left = "left"
    right = "right"


class FlagStatus(str, enum.Enum):
    active = "active"
    stale = "stale"
    stolen = "stolen"
    invalid = "invalid"


class SubmissionStatus(str, enum.Enum):
    accepted = "accepted"
    duplicate = "duplicate"
    stale = "stale"
    invalid = "invalid"
    self_owned = "self_owned"


class CheckerKind(str, enum.Enum):
    put_flag = "put_flag"
    get_flag = "get_flag"
    health_check = "health_check"
    exploit_replay = "exploit_replay"


class ScoreEventType(str, enum.Enum):
    service_up = "SERVICE_UP"
    service_down = "SERVICE_DOWN"
    flag_stolen_first = "FLAG_STOLEN_FIRST"
    flag_lost_first = "FLAG_LOST_FIRST"
    submission_duplicate = "SUBMISSION_DUPLICATE"
    submission_stale = "SUBMISSION_STALE"
    patch_success_first = "PATCH_SUCCESS_FIRST"


class DatasetArtifact(Base):
    __tablename__ = "dataset_artifacts"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    service_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    repo_url: Mapped[str] = mapped_column(String, nullable=False)
    pinned_commit: Mapped[str] = mapped_column(String, nullable=False)
    clean_repo_bundle: Mapped[str] = mapped_column(String, nullable=False)
    vuln_repo_bundle: Mapped[str] = mapped_column(String, nullable=False)
    runtime_spec: Mapped[dict] = mapped_column(JSON, nullable=False)
    flag_spec: Mapped[dict] = mapped_column(JSON, nullable=False)
    seed_metadata: Mapped[dict] = mapped_column(JSON, nullable=False)
    checker_paths: Mapped[dict] = mapped_column(JSON, nullable=False)
    reference_patch: Mapped[str] = mapped_column(String, nullable=False)
    wave_variants: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)


class Round(Base):
    __tablename__ = "rounds"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    requested_by: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[RoundStatus] = mapped_column(Enum(RoundStatus), default=RoundStatus.draft, nullable=False)
    round_duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    wave_duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    current_wave: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    docker_network: Mapped[str | None] = mapped_column(String, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)

    services: Mapped[list["RoundService"]] = relationship(back_populates="round", cascade="all, delete-orphan")
    teams: Mapped[list["Team"]] = relationship(back_populates="round", cascade="all, delete-orphan")


class RoundService(Base):
    __tablename__ = "round_services"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    round_id: Mapped[str] = mapped_column(ForeignKey("rounds.id"), nullable=False, index=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("dataset_artifacts.id"), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)

    round: Mapped[Round] = relationship(back_populates="services")
    artifact: Mapped[DatasetArtifact] = relationship()


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    round_id: Mapped[str] = mapped_column(ForeignKey("rounds.id"), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[TeamRole] = mapped_column(Enum(TeamRole), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)

    round: Mapped[Round] = relationship(back_populates="teams")
    services: Mapped[list["TeamServiceInstance"]] = relationship(back_populates="team", cascade="all, delete-orphan")


class TeamServiceInstance(Base):
    __tablename__ = "team_service_instances"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    round_id: Mapped[str] = mapped_column(ForeignKey("rounds.id"), nullable=False, index=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), nullable=False, index=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("dataset_artifacts.id"), nullable=False)
    service_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    workspace_path: Mapped[str] = mapped_column(String, nullable=False)
    local_url: Mapped[str] = mapped_column(String, nullable=False)
    health_url: Mapped[str] = mapped_column(String, nullable=False)
    container_name: Mapped[str | None] = mapped_column(String, nullable=True)
    running: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    patched: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_health_status: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    team: Mapped[Team] = relationship(back_populates="services")
    artifact: Mapped[DatasetArtifact] = relationship()


class Flag(Base):
    __tablename__ = "flags"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    round_id: Mapped[str] = mapped_column(ForeignKey("rounds.id"), nullable=False, index=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), nullable=False, index=True)
    service_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    team_service_instance_id: Mapped[str] = mapped_column(ForeignKey("team_service_instances.id"), nullable=False, index=True)
    wave: Mapped[int] = mapped_column(Integer, nullable=False)
    value: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    status: Mapped[FlagStatus] = mapped_column(Enum(FlagStatus), default=FlagStatus.active, nullable=False)
    first_stolen_by: Mapped[str | None] = mapped_column(String, nullable=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    round_id: Mapped[str] = mapped_column(ForeignKey("rounds.id"), nullable=False, index=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), nullable=False, index=True)
    submitted_flag: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[SubmissionStatus] = mapped_column(Enum(SubmissionStatus), nullable=False)
    flag_id: Mapped[str | None] = mapped_column(ForeignKey("flags.id"), nullable=True)
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)


class ScoreEvent(Base):
    __tablename__ = "score_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    round_id: Mapped[str] = mapped_column(ForeignKey("rounds.id"), nullable=False, index=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), nullable=False, index=True)
    service_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    wave: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[ScoreEventType] = mapped_column(Enum(ScoreEventType), nullable=False)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    related_team_id: Mapped[str | None] = mapped_column(String, nullable=True)
    flag_id: Mapped[str | None] = mapped_column(String, nullable=True)
    submission_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)


class CheckerRun(Base):
    __tablename__ = "checker_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    round_id: Mapped[str] = mapped_column(ForeignKey("rounds.id"), nullable=False, index=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), nullable=False, index=True)
    service_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    kind: Mapped[CheckerKind] = mapped_column(Enum(CheckerKind), nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    exit_code: Mapped[int] = mapped_column(Integer, nullable=False)
    stdout: Mapped[str] = mapped_column(Text, default="", nullable=False)
    stderr: Mapped[str] = mapped_column(Text, default="", nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    finished_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class TeamTrace(Base):
    __tablename__ = "team_traces"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    round_id: Mapped[str] = mapped_column(ForeignKey("rounds.id"), nullable=False, index=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), nullable=False, index=True)
    phase: Mapped[str] = mapped_column(String, nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)


class RoundStateSnapshot(Base):
    __tablename__ = "round_state_snapshots"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    round_id: Mapped[str] = mapped_column(ForeignKey("rounds.id"), nullable=False, index=True)
    wave: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
