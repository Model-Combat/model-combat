from __future__ import annotations

import socket
import shutil
import subprocess
import time
from http.client import RemoteDisconnected
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from model_combat.config import Settings
from model_combat.runtime.base import ProvisionedService, RuntimeAdapter
from model_combat.storage.models import Round, TeamServiceInstance


class DockerRuntime(RuntimeAdapter):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _allocate_host_port(self) -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])

    def provision_round(self, round_obj: Round) -> str:
        network_name = f"model-combat-{round_obj.id}"
        subprocess.run(["docker", "network", "create", network_name], check=True, capture_output=True, text=True)
        return network_name

    def _wait_for_health(self, health_url: str, *, timeout_seconds: int = 240) -> None:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            try:
                with urlopen(health_url, timeout=2) as response:
                    if 200 <= response.status < 300:
                        return
            except (URLError, RemoteDisconnected, ConnectionError, TimeoutError):
                pass
            time.sleep(1)
        raise TimeoutError(f"service did not become healthy in time: {health_url}")

    def _cache_volume_name(self, service_instance: TeamServiceInstance, suffix: str) -> str:
        return f"model-combat-{service_instance.id[:8]}-{suffix}"

    def _cache_mount_args(self, service_instance: TeamServiceInstance) -> list[str]:
        mod_volume = self._cache_volume_name(service_instance, "gomod")
        build_volume = self._cache_volume_name(service_instance, "gobuild")
        subprocess.run(["docker", "volume", "create", mod_volume], check=True, capture_output=True, text=True)
        subprocess.run(["docker", "volume", "create", build_volume], check=True, capture_output=True, text=True)
        return [
            "-e",
            "GOMODCACHE=/go/pkg/mod",
            "-e",
            "GOCACHE=/root/.cache/go-build",
            "-v",
            f"{mod_volume}:/go/pkg/mod",
            "-v",
            f"{build_volume}:/root/.cache/go-build",
        ]

    def _source_bundle(self, service_instance: TeamServiceInstance) -> Path:
        return Path(service_instance.metadata_json.get("active_vuln_repo_bundle") or service_instance.artifact.vuln_repo_bundle)

    def _remove_container(self, container_name: str | None) -> None:
        if not container_name:
            return
        subprocess.run(
            ["docker", "rm", "-f", container_name],
            check=False,
            capture_output=True,
            text=True,
        )

    def _start_container(self, *, network_name: str, service_instance: TeamServiceInstance, host_port: int, timeout_seconds: int = 240) -> ProvisionedService:
        artifact = service_instance.artifact
        runtime_spec = artifact.runtime_spec
        container_name = f"{service_instance.team_id}-{service_instance.service_id}-{service_instance.id[:8]}"
        image = runtime_spec.get("docker_image") or "python:3.12-slim"
        port = int(runtime_spec["port"])
        env_items = runtime_spec.get("env", {})
        env_args: list[str] = []
        for key, value in env_items.items():
            env_args.extend(["-e", f"{key}={value}"])

        command = runtime_spec["start_command"]
        subprocess.run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                container_name,
                "--network",
                network_name,
                "-w",
                runtime_spec["working_directory"],
                "-p",
                f"127.0.0.1:{host_port}:{port}",
                "-v",
                f"{service_instance.workspace_path}:{runtime_spec['working_directory']}",
                *self._cache_mount_args(service_instance),
                *env_args,
                image,
                "sh",
                "-lc",
                command,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        local_url = f"http://127.0.0.1:{host_port}"
        health_path = runtime_spec.get("health_path") or "/health"
        provisioned = ProvisionedService(
            workspace_path=service_instance.workspace_path,
            local_url=local_url,
            health_url=f"{local_url}{health_path}",
            container_name=container_name,
        )
        self._wait_for_health(provisioned.health_url, timeout_seconds=timeout_seconds)
        return provisioned

    def provision_service(self, *, network_name: str, service_instance: TeamServiceInstance) -> ProvisionedService:
        artifact = service_instance.artifact
        source_bundle = self._source_bundle(service_instance)
        workspace_path = Path(service_instance.workspace_path)
        workspace_path.parent.mkdir(parents=True, exist_ok=True)
        if workspace_path.exists():
            shutil.rmtree(workspace_path)
        shutil.copytree(source_bundle, workspace_path)
        host_port = self._allocate_host_port()
        provisioned = self._start_container(network_name=network_name, service_instance=service_instance, host_port=host_port)
        return ProvisionedService(
            workspace_path=str(workspace_path),
            local_url=provisioned.local_url,
            health_url=provisioned.health_url,
            container_name=provisioned.container_name,
        )

    def reset_service(self, *, network_name: str, service_instance: TeamServiceInstance) -> ProvisionedService:
        self._remove_container(service_instance.container_name)
        source_bundle = self._source_bundle(service_instance)
        workspace_path = Path(service_instance.workspace_path)
        if workspace_path.exists():
            shutil.rmtree(workspace_path)
        shutil.copytree(source_bundle, workspace_path)
        host_port = int(service_instance.local_url.rsplit(":", 1)[-1])
        return self._start_container(network_name=network_name, service_instance=service_instance, host_port=host_port, timeout_seconds=420)

    def restart_service(self, service_instance: TeamServiceInstance) -> None:
        if service_instance.container_name:
            subprocess.run(["docker", "restart", service_instance.container_name], check=True, capture_output=True, text=True)

    def service_logs(self, service_instance: TeamServiceInstance) -> str:
        if not service_instance.container_name:
            return ""
        completed = subprocess.run(
            ["docker", "logs", "--tail", "200", service_instance.container_name],
            check=False,
            capture_output=True,
            text=True,
        )
        return completed.stdout + completed.stderr

    def shutdown_round(self, round_id: str, instances: list[TeamServiceInstance]) -> None:
        del round_id
        for instance in instances:
            if instance.container_name:
                self._remove_container(instance.container_name)
