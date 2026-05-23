from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any


REDACTION = "[redacted]"
SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"sk-proj-[A-Za-z0-9_-]{16,}"),
    re.compile(r"sk-ant-[A-Za-z0-9_-]{16,}"),
    re.compile(r"MC\{[^}\s]{1,512}\}"),
    re.compile(r"Basic\s+[A-Za-z0-9+/=]{8,}", re.IGNORECASE),
)
SECRET_ENV_HINTS = ("KEY", "TOKEN", "SECRET", "PASSWORD", "PASS")


def redact_secrets(value: Any) -> Any:
    if isinstance(value, str):
        return _redact_text(value)
    if isinstance(value, dict):
        return {k: redact_secrets(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_secrets(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_secrets(item) for item in value)
    return value


def _redact_text(text: str) -> str:
    redacted = text
    for secret in _known_secret_values():
        redacted = redacted.replace(secret, REDACTION)
    for pattern in SECRET_PATTERNS:
        redacted = pattern.sub(REDACTION, redacted)
    return redacted


def _known_secret_values() -> set[str]:
    values: set[str] = set()
    for key, value in os.environ.items():
        if _looks_secret_key(key) and len(value) >= 8:
            values.add(value)
    values.update(_dotenv_secret_values())
    return values


def _dotenv_secret_values() -> set[str]:
    env_path = Path(".env")
    if not env_path.exists():
        return set()
    try:
        lines = env_path.read_text().splitlines()
    except OSError:
        return set()

    values: set[str] = set()
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key.removeprefix("export ").strip()
        if not _looks_secret_key(key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if len(value) >= 8:
            values.add(value)
    return values


def _looks_secret_key(key: str) -> bool:
    normalized = key.upper()
    return any(hint in normalized for hint in SECRET_ENV_HINTS)
