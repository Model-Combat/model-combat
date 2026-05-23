from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_gotify_manifest_entry_points_to_real_files() -> None:
    manifest = json.loads((ROOT / "data/artifacts/manifest.json").read_text())
    artifact = next(item for item in manifest["artifacts"] if item["artifact_id"] == "gotify-v1")

    assert artifact["service_id"] == "gotify"
    assert artifact["seed_metadata"]["vuln_class"] == "authorization"
    assert len(artifact["wave_variants"]) == 3

    for key in ("clean_repo_bundle", "vuln_repo_bundle", "reference_patch"):
        assert (ROOT / artifact[key]).exists()

    for path in artifact["checker_paths"].values():
        checker = ROOT / path
        assert checker.exists()
        assert checker.stat().st_mode & 0o111

    for variant in artifact["wave_variants"]:
        assert (ROOT / variant["vuln_repo_bundle"]).exists()
        assert (ROOT / variant["reference_patch"]).exists()
        for path in variant["checker_paths"].values():
            checker = ROOT / path
            assert checker.exists()
            assert checker.stat().st_mode & 0o111

    assert "go build" not in artifact["runtime_spec"]["start_command"]


def test_gotify_vuln_bundle_contains_expected_authz_regression() -> None:
    clean_message = (ROOT / "data/artifacts/gotify-v1/clean/api/message.go").read_text()
    vuln_message = (ROOT / "data/artifacts/gotify-v1/vuln/api/message.go").read_text()
    patch = (ROOT / "data/artifacts/gotify-v1/reference_patch.diff").read_text()

    assert "if app != nil && app.UserID == auth.GetUserID(ctx) {" in clean_message
    assert "if app != nil {" in vuln_message
    assert "-\t\t\tif app != nil {" in patch
    assert "+\t\t\tif app != nil && app.UserID == auth.GetUserID(ctx) {" in patch


def test_additional_gotify_wave_variants_have_distinct_regressions() -> None:
    wave2_vuln = (ROOT / "data/artifacts/gotify-wave2/vuln/database/application.go").read_text()
    wave2_patch = (ROOT / "data/artifacts/gotify-wave2/reference_patch.diff").read_text()
    wave3_vuln = (ROOT / "data/artifacts/gotify-wave3/vuln/database/message.go").read_text()
    wave3_patch = (ROOT / "data/artifacts/gotify-wave3/reference_patch.diff").read_text()

    assert 'd.DB.Order("sort_key, id ASC").Find(&apps).Error' in wave2_vuln
    assert 'd.DB.Where("user_id = ?", userID).Order("sort_key, id ASC").Find(&apps).Error' in wave2_patch
    assert 'Joins("JOIN applications ON applications.id = messages.application_id")' in wave3_vuln
    assert 'Joins("JOIN applications ON applications.user_id = ?", userID)' in wave3_patch


def test_gotify_wave_bundles_include_prebuilt_linux_binary() -> None:
    bundles = [
        ROOT / "data/artifacts/gotify-v1/vuln",
        ROOT / "data/artifacts/gotify-wave2/vuln",
        ROOT / "data/artifacts/gotify-wave3/vuln",
    ]

    for bundle in bundles:
        binary = bundle / "build/gotify"
        assert binary.exists()
        assert binary.stat().st_mode & 0o111
