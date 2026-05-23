from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.orm import Session

from model_combat.api.schemas import DatasetArtifactCreate
from model_combat.storage.models import DatasetArtifact


class ArtifactLoader:
    def __init__(self, artifacts_root: Path) -> None:
        self.artifacts_root = artifacts_root

    def manifest_path(self) -> Path:
        return self.artifacts_root / "manifest.json"

    def load_manifest(self) -> list[DatasetArtifactCreate]:
        manifest_path = self.manifest_path()
        if not manifest_path.exists():
            return []
        payload = json.loads(manifest_path.read_text())
        return [DatasetArtifactCreate.model_validate(item) for item in payload.get("artifacts", [])]

    def sync_to_db(self, session: Session) -> int:
        count = 0
        for artifact in self.load_manifest():
            existing = session.get(DatasetArtifact, artifact.artifact_id)
            payload = artifact.model_dump(mode="json")
            if existing is None:
                existing = DatasetArtifact(
                    id=payload["artifact_id"],
                    service_id=payload["service_id"],
                    display_name=payload["display_name"],
                    repo_url=payload["repo_url"],
                    pinned_commit=payload["pinned_commit"],
                    clean_repo_bundle=payload["clean_repo_bundle"],
                    vuln_repo_bundle=payload["vuln_repo_bundle"],
                    runtime_spec=payload["runtime_spec"],
                    flag_spec=payload["flag_spec"],
                    seed_metadata=payload["seed_metadata"],
                    checker_paths=payload["checker_paths"],
                    reference_patch=payload["reference_patch"],
                    wave_variants=payload["wave_variants"],
                    active=payload["active"],
                )
                session.add(existing)
            else:
                existing.service_id = payload["service_id"]
                existing.display_name = payload["display_name"]
                existing.repo_url = payload["repo_url"]
                existing.pinned_commit = payload["pinned_commit"]
                existing.clean_repo_bundle = payload["clean_repo_bundle"]
                existing.vuln_repo_bundle = payload["vuln_repo_bundle"]
                existing.runtime_spec = payload["runtime_spec"]
                existing.flag_spec = payload["flag_spec"]
                existing.seed_metadata = payload["seed_metadata"]
                existing.checker_paths = payload["checker_paths"]
                existing.reference_patch = payload["reference_patch"]
                existing.wave_variants = payload["wave_variants"]
                existing.active = payload["active"]
            count += 1
        session.commit()
        return count
