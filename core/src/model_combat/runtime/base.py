from __future__ import annotations

from dataclasses import dataclass

from model_combat.storage.models import Round, TeamServiceInstance


@dataclass
class ProvisionedService:
    workspace_path: str
    local_url: str
    health_url: str
    container_name: str | None


class RuntimeAdapter:
    def provision_round(self, round_obj: Round) -> str:
        raise NotImplementedError

    def provision_service(self, *, network_name: str, service_instance: TeamServiceInstance) -> ProvisionedService:
        raise NotImplementedError

    def reset_service(self, *, network_name: str, service_instance: TeamServiceInstance) -> ProvisionedService:
        raise NotImplementedError

    def restart_service(self, service_instance: TeamServiceInstance) -> None:
        raise NotImplementedError

    def service_logs(self, service_instance: TeamServiceInstance) -> str:
        raise NotImplementedError

    def shutdown_round(self, round_id: str, instances: list[TeamServiceInstance]) -> None:
        del round_id, instances
