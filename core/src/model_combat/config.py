from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MODEL_COMBAT_",
        env_file=".env",
        extra="ignore",
    )

    app_name: str = "Model Combat v1"
    database_url: str = "sqlite+pysqlite:///.model_combat/live-round.db"
    artifacts_root: Path = Path("data/artifacts")
    workspace_root: Path = Path(".model_combat/workspaces")
    judge_base_url: str = "http://127.0.0.1:8000"
    runtime_backend: str | None = None  # None => docker if docker_enabled else process
    openai_model_name: str = "gpt-5.5"
    openai_reasoning_effort: str = "medium"
    openai_api_key_env: str = "OPENAI_API_KEY"
    anthropic_model_name: str = "claude-opus-4-7"
    anthropic_reasoning_effort: str = "medium"
    anthropic_api_key_env: str = "ANTHROPIC_API_KEY"
    opencode_model_name: str = "kimi-k2.6"
    opencode_reasoning_effort: str = "low"
    opencode_api_key_env: str = "OPENCODE_API_KEY"
    opencode_base_url: str = "https://opencode.ai/zen/v1"
    agent_max_steps: int = 50
    wave_max_steps: int = 50
    agent_command_timeout_seconds: int = 300
    docker_enabled: bool = False
    # Wall-clock wave ticking via apscheduler. Off by default — the match
    # orchestrator drives waves explicitly (one agent run per wave). Turn on
    # only if you want time-based wave rotation independent of agent progress.
    scheduler_enabled: bool = False
    service_ready_timeout_seconds: int = 300
    service_ready_poll_interval_seconds: float = 2.0
    round_duration_seconds: int = 3600
    wave_duration_seconds: int = 300
    offense_points: int = 100
    defense_loss_points: int = -100
    service_down_points: int = -10
    service_up_points: int = 1
    service_up_score_cap: int = 50
    patch_success_points: int = 25
    seed_artifact_ids: list[str] = Field(default_factory=list)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
