from __future__ import annotations

import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


@dataclass
class CheckerExecutionResult:
    success: bool
    exit_code: int
    stdout: str
    stderr: str
    started_at: datetime
    finished_at: datetime


class CheckerExecutor:
    def run(self, script_path: str, *, cwd: str, env: dict[str, str] | None = None) -> CheckerExecutionResult:
        started_at = datetime.now(UTC)
        completed = subprocess.run(
            [script_path],
            cwd=str(Path(cwd)),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        finished_at = datetime.now(UTC)
        return CheckerExecutionResult(
            success=completed.returncode == 0,
            exit_code=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
            started_at=started_at,
            finished_at=finished_at,
        )
