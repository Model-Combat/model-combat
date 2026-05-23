from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class RuntimeSpecModel(BaseModel):
    build_command: str
    start_command: str
    process_build_command: str | None = None
    process_start_command: str | None = None
    working_directory: str
    port: int
    health_path: str | None = None
    env: dict[str, str] = Field(default_factory=dict)
    persistent_paths: list[str] = Field(default_factory=list)
    docker_image: str | None = None


class WaveVariantModel(BaseModel):
    variant_id: str
    display_name: str | None = None
    vuln_repo_bundle: str
    checker_paths: dict[str, str]
    seed_metadata: dict[str, Any] = Field(default_factory=dict)
    flag_spec: dict[str, Any] = Field(default_factory=dict)
    reference_patch: str | None = None


class DatasetArtifactCreate(BaseModel):
    artifact_id: str
    service_id: str
    display_name: str
    repo_url: str
    pinned_commit: str
    clean_repo_bundle: str
    vuln_repo_bundle: str
    runtime_spec: RuntimeSpecModel
    flag_spec: dict[str, Any] = Field(default_factory=dict)
    seed_metadata: dict[str, Any] = Field(default_factory=dict)
    checker_paths: dict[str, str]
    reference_patch: str
    wave_variants: list[WaveVariantModel] = Field(default_factory=list)
    active: bool = True


class RoundCreateRequest(BaseModel):
    requested_by: str
    artifact_ids: list[str] | None = None
    round_duration_seconds: int | None = None
    wave_duration_seconds: int | None = None


class RoundStateResponse(BaseModel):
    round_id: str
    status: str
    current_wave: int
    round_duration_seconds: int
    wave_duration_seconds: int
    started_at: datetime | None
    ended_at: datetime | None
    service_ids: list[str]
    team_ids: list[str]


class TeamBootstrapService(BaseModel):
    service_id: str
    display_name: str
    code_path: str
    working_directory: str
    local_url: str
    health_url: str
    default_credentials: dict[str, str] = Field(default_factory=dict)
    build_command: str
    start_command: str
    restart_command: str
    log_command: str


class TeamBootstrapTarget(BaseModel):
    team_id: str
    service_id: str
    display_name: str
    base_url: str
    attack_credentials: dict[str, str] = Field(default_factory=dict)


class TeamBootstrapResponse(BaseModel):
    round_id: str
    team_id: str
    wave: int
    wave_duration_seconds: int
    round_duration_seconds: int
    judge_base_url: str
    targets: list[TeamBootstrapTarget]
    services: list[TeamBootstrapService]
    rules: list[str]


class TeamServiceStatusResponse(BaseModel):
    team_id: str
    service_id: str
    local_url: str
    health_url: str
    running: bool
    patched: bool
    last_health_status: bool | None


class AgentLaunchResponse(BaseModel):
    team_id: str
    round_id: str
    provider: str
    model_name: str
    reasoning_effort: str | None = None
    workspace_root: str
    arena_dir: str
    bootstrap_path: str
    instructions_path: str
    helper_commands: list[str]
    env: dict[str, str]
    prompt: str


class AgentRunResponse(BaseModel):
    provider: str
    model_name: str
    team_id: str
    round_id: str
    status: str
    final_message: str
    steps: list[dict[str, Any]]


class MatchRunResponse(BaseModel):
    round_id: str
    providers: dict[str, str]
    team_results: list[AgentRunResponse]
    scoreboard: list[LeaderboardEntry]
    trajectory_audit: TrajectoryAuditResponse | None = None
    post_match_errors: list[str] = []


class FlagSubmissionRequest(BaseModel):
    team_id: str
    flag: str


class FlagSubmissionResponse(BaseModel):
    accepted: bool
    reason: str | None = None
    victim_team_id: str | None = None
    service_id: str | None = None
    wave: int | None = None
    points_awarded: int = 0


class ScoreEventResponse(BaseModel):
    event_id: str
    team_id: str
    service_id: str
    wave: int
    type: str
    delta: int
    related_team_id: str | None
    created_at: datetime


class CheckerRunResponse(BaseModel):
    checker_run_id: str
    team_id: str
    service_id: str
    kind: str
    success: bool
    exit_code: int
    started_at: datetime
    finished_at: datetime


class TrajectoryAuditEventResponse(BaseModel):
    trace_id: str | None
    team_id: str | None
    phase: str | None
    event_type: str | None
    source: str
    markers: list[str]
    arguments: dict[str, Any]


class TrajectoryAuditResponse(BaseModel):
    ok: bool
    trace_count: int
    forbidden_event_count: int
    forbidden_events: list[TrajectoryAuditEventResponse]
    checked_markers: list[str]


class LeaderboardEntry(BaseModel):
    team_id: str
    score: int
    services_up: int
    services_down: int
    flags_stolen: int
    flags_lost: int
    patches_completed: int = 0


class WaveResponse(BaseModel):
    round_id: str
    wave: int
    status: Literal["draft", "running", "paused", "aborted", "finalized"]


class ArtifactResponse(BaseModel):
    artifact_id: str
    service_id: str
    display_name: str
    repo_url: str
    pinned_commit: str
    active: bool
