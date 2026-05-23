from __future__ import annotations

import shutil
from pathlib import Path

from model_combat.runtime.base import ProvisionedService, RuntimeAdapter
from model_combat.storage.models import Round, TeamServiceInstance


class NoopRuntime(RuntimeAdapter):
    def provision_round(self, round_obj: Round) -> str:
        return f"noop-{round_obj.id}"

    def provision_service(self, *, network_name: str, service_instance: TeamServiceInstance) -> ProvisionedService:
        workspace_path = Path(service_instance.workspace_path)
        source_bundle = Path(service_instance.metadata_json.get("active_vuln_repo_bundle") or service_instance.artifact.vuln_repo_bundle)
        workspace_path.parent.mkdir(parents=True, exist_ok=True)
        if workspace_path.exists():
            shutil.rmtree(workspace_path)
        shutil.copytree(source_bundle, workspace_path)
        return ProvisionedService(
            workspace_path=str(workspace_path),
            local_url=service_instance.local_url,
            health_url=service_instance.health_url,
            container_name=None,
        )

    def reset_service(self, *, network_name: str, service_instance: TeamServiceInstance) -> ProvisionedService:
        return self.provision_service(network_name=network_name, service_instance=service_instance)

    def restart_service(self, service_instance: TeamServiceInstance) -> None:
        return None

    def service_logs(self, service_instance: TeamServiceInstance) -> str:
        return ""
