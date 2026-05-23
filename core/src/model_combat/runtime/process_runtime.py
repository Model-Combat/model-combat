from __future__ import annotations

import os
import signal
import shutil
import socket
import subprocess
from pathlib import Path

from model_combat.config import Settings
from model_combat.runtime.base import ProvisionedService, RuntimeAdapter
from model_combat.storage.models import Round, TeamServiceInstance


class ProcessRuntime(RuntimeAdapter):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.processes: dict[str, subprocess.Popen[str]] = {}
        self.log_paths: dict[str, Path] = {}

    def _allocate_host_port(self) -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])

    def provision_round(self, round_obj: Round) -> str:
        return f"process-{round_obj.id}"

    def provision_service(self, *, network_name: str, service_instance: TeamServiceInstance) -> ProvisionedService:
        del network_name
        artifact = service_instance.artifact
        runtime_spec = artifact.runtime_spec
        source_bundle = Path(service_instance.metadata_json.get("active_vuln_repo_bundle") or artifact.vuln_repo_bundle)
        workspace_path = Path(service_instance.workspace_path)
        workspace_path.parent.mkdir(parents=True, exist_ok=True)
        if workspace_path.exists():
            shutil.rmtree(workspace_path)
        shutil.copytree(source_bundle, workspace_path)

        host_port = self._allocate_host_port()
        log_dir = workspace_path / ".model_combat"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "service.log"
        env = os.environ.copy()
        env.update({str(key): str(value) for key, value in runtime_spec.get("env", {}).items()})
        credentials = service_instance.metadata_json.get("default_credentials", {})
        env["MODEL_COMBAT_DEFAULT_USER_NAME"] = str(credentials.get("username", "admin"))
        env["MODEL_COMBAT_DEFAULT_USER_PASS"] = str(credentials.get("password", "admin"))
        env["MODEL_COMBAT_SERVICE_PORT"] = str(host_port)
        command = runtime_spec.get("process_start_command") or runtime_spec["start_command"]

        with log_path.open("w") as log_file:
            process = subprocess.Popen(
                ["sh", "-lc", command],
                cwd=workspace_path,
                env=env,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
        self.processes[service_instance.id] = process
        self.log_paths[service_instance.id] = log_path

        local_url = f"http://127.0.0.1:{host_port}"
        health_path = runtime_spec.get("health_path") or "/health"
        return ProvisionedService(
            workspace_path=str(workspace_path),
            local_url=local_url,
            health_url=f"{local_url}{health_path}",
            container_name=f"process-{process.pid}",
        )

    def reset_service(self, *, network_name: str, service_instance: TeamServiceInstance) -> ProvisionedService:
        del network_name
        existing = self.processes.get(service_instance.id)
        self._terminate_process(existing)
        return self.provision_service(network_name="process-reset", service_instance=service_instance)

    def restart_service(self, service_instance: TeamServiceInstance) -> None:
        existing = self.processes.get(service_instance.id)
        self._terminate_process(existing)

        artifact = service_instance.artifact
        runtime_spec = artifact.runtime_spec
        env = os.environ.copy()
        env.update({str(key): str(value) for key, value in runtime_spec.get("env", {}).items()})
        credentials = service_instance.metadata_json.get("default_credentials", {})
        env["MODEL_COMBAT_DEFAULT_USER_NAME"] = str(credentials.get("username", "admin"))
        env["MODEL_COMBAT_DEFAULT_USER_PASS"] = str(credentials.get("password", "admin"))
        service_port = service_instance.local_url.rsplit(":", 1)[-1]
        env["MODEL_COMBAT_SERVICE_PORT"] = service_port
        command = runtime_spec.get("process_start_command") or runtime_spec["start_command"]
        log_path = self.log_paths.get(service_instance.id)
        if log_path is None:
            log_path = Path(service_instance.workspace_path) / ".model_combat" / "service.log"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            self.log_paths[service_instance.id] = log_path
        with log_path.open("a") as log_file:
            process = subprocess.Popen(
                ["sh", "-lc", command],
                cwd=service_instance.workspace_path,
                env=env,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
        self.processes[service_instance.id] = process

    def service_logs(self, service_instance: TeamServiceInstance) -> str:
        log_path = self.log_paths.get(service_instance.id)
        if log_path is None or not log_path.exists():
            return ""
        return log_path.read_text()

    def shutdown_round(self, round_id: str, instances: list[TeamServiceInstance]) -> None:
        del round_id
        for instance in instances:
            self._terminate_process(self.processes.pop(instance.id, None))

    def _terminate_process(self, process: subprocess.Popen[str] | None) -> None:
        if process is None or process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        except OSError:
            process.terminate()
        try:
            process.wait(timeout=10)
            return
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        except OSError:
            process.kill()
        process.wait(timeout=5)
