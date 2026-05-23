from __future__ import annotations

import pytest

from model_combat.config import get_settings


@pytest.fixture(autouse=True)
def model_combat_test_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MODEL_COMBAT_RUNTIME_BACKEND", "noop")
    monkeypatch.setenv("MODEL_COMBAT_SCHEDULER_ENABLED", "false")
    monkeypatch.setenv("MODEL_COMBAT_DOCKER_ENABLED", "false")
    monkeypatch.delenv("MODEL_COMBAT_PREFER_DOTENV_API_KEYS", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
