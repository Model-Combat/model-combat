from __future__ import annotations

from collections import defaultdict

from model_combat.config import Settings
from model_combat.storage.models import ScoreEvent, ScoreEventType, TeamServiceInstance


def score_delta(event_type: ScoreEventType, settings: Settings) -> int:
    mapping = {
        ScoreEventType.service_up: settings.service_up_points,
        ScoreEventType.service_down: settings.service_down_points,
        ScoreEventType.flag_stolen_first: settings.offense_points,
        ScoreEventType.flag_lost_first: settings.defense_loss_points,
        ScoreEventType.submission_duplicate: 0,
        ScoreEventType.submission_stale: 0,
        ScoreEventType.patch_success_first: settings.patch_success_points,
    }
    return mapping[event_type]


def build_leaderboard(
    team_ids: list[str],
    score_events: list[ScoreEvent],
    service_instances: list[TeamServiceInstance],
    settings: Settings | None = None,
) -> list[dict]:
    uptime_cap = getattr(settings, "service_up_score_cap", None) if settings else None
    uptime_totals = defaultdict(int)
    other_totals = defaultdict(int)
    flags_stolen = defaultdict(int)
    flags_lost = defaultdict(int)
    patches_completed = defaultdict(int)
    services_up = defaultdict(int)
    services_down = defaultdict(int)

    for event in score_events:
        if event.type == ScoreEventType.service_up:
            uptime_totals[event.team_id] += event.delta
        else:
            other_totals[event.team_id] += event.delta
        if event.type == ScoreEventType.flag_stolen_first:
            flags_stolen[event.team_id] += 1
        if event.type == ScoreEventType.flag_lost_first:
            flags_lost[event.team_id] += 1
        if event.type == ScoreEventType.patch_success_first:
            patches_completed[event.team_id] += 1

    for instance in service_instances:
        if instance.last_health_status:
            services_up[instance.team_id] += 1
        else:
            services_down[instance.team_id] += 1

    rows = []
    for team_id in team_ids:
        uptime_score = uptime_totals[team_id]
        if uptime_cap is not None:
            uptime_score = min(uptime_score, uptime_cap)
        rows.append(
            {
                "team_id": team_id,
                "score": other_totals[team_id] + uptime_score,
                "services_up": services_up[team_id],
                "services_down": services_down[team_id],
                "flags_stolen": flags_stolen[team_id],
                "flags_lost": flags_lost[team_id],
                "patches_completed": patches_completed[team_id],
            }
        )
    rows.sort(key=lambda item: (-item["score"], item["team_id"]))
    return rows
