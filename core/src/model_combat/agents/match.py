from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from model_combat.api.schemas import AgentRunResponse
from model_combat.config import Settings
from model_combat.domain.service import RoundManager
from model_combat.domain.trajectory_audit import audit_trace_rows
from model_combat.redaction import redact_secrets
from model_combat.storage.models import RoundStatus, TeamTrace


FATAL_PROVIDER_ERROR_MARKERS = (
    "cyber_policy",
    "content_policy",
    "invalid_api_key",
    "permission_denied",
    "401 unauthorized",
    "403 forbidden",
)


def _is_fatal_error(result: AgentRunResponse) -> bool:
    if result.status != "error":
        return False
    msg = (result.final_message or "").lower()
    return any(marker in msg for marker in FATAL_PROVIDER_ERROR_MARKERS)


def _merge_per_wave_results(
    per_wave: list[dict[str, "AgentRunResponse"]],
    specs: list["TeamMatchSpec"],
) -> list["AgentRunResponse"]:
    """Combine each team's per-wave AgentRunResponses into a single summary
    response that matches the existing schema. Steps are concatenated;
    status/final_message reflect the last wave that actually ran.
    """
    out: list[AgentRunResponse] = []
    for spec in specs:
        per_team = [w[spec.team_id] for w in per_wave if spec.team_id in w]
        if not per_team:
            out.append(
                AgentRunResponse(
                    provider=spec.provider,
                    model_name=spec.model_name or "unknown",
                    team_id=spec.team_id,
                    round_id="",
                    status="no_run",
                    final_message="no waves completed",
                    steps=[],
                )
            )
            continue
        merged_steps: list[dict] = []
        for w_idx, r in enumerate(per_team, start=1):
            for s in r.steps:
                tagged = dict(s)
                tagged["wave"] = w_idx
                merged_steps.append(tagged)
        last = per_team[-1]
        out.append(
            AgentRunResponse(
                provider=last.provider,
                model_name=last.model_name,
                team_id=last.team_id,
                round_id=last.round_id,
                status=last.status,
                final_message=last.final_message,
                steps=merged_steps,
            )
        )
    return out


@dataclass(frozen=True)
class TeamMatchSpec:
    team_id: str
    provider: str
    model_name: str | None = None
    reasoning_effort: str | None = None


class MatchOrchestrator:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        settings: Settings,
        runtime,
        checker_executor,
        scheduler_service=None,
    ) -> None:
        self.session_factory = session_factory
        self.settings = settings
        self.runtime = runtime
        self.checker_executor = checker_executor
        self.scheduler_service = scheduler_service

    def run_match(
        self,
        *,
        round_id: str,
        left_provider: str,
        right_provider: str,
        left_model: str | None = None,
        right_model: str | None = None,
        left_reasoning: str | None = None,
        right_reasoning: str | None = None,
    ) -> dict:
        session = self.session_factory()
        try:
            manager = RoundManager(
                session=session,
                settings=self.settings,
                runtime=self.runtime,
                checker_executor=self.checker_executor,
            )
            round_obj = manager.get_round(round_id)
            if round_obj.status == RoundStatus.draft:
                round_obj = manager.provision_round(round_id)
            if round_obj.status in {RoundStatus.provisioned, RoundStatus.paused}:
                round_obj = manager.start_round(round_id)
            team_ids = [team.id for team in round_obj.teams]
            num_waves = manager.num_waves_for_round(round_id)
        finally:
            session.close()

        # The orchestrator owns wave progression. If a wall-clock scheduler tick
        # somehow got registered (e.g. HTTP /start was called), drop it now so it
        # doesn't race our explicit advance_wave calls.
        if self.scheduler_service is not None:
            try:
                self.scheduler_service.unschedule_round(round_id)
            except Exception:
                pass

        specs = [
            TeamMatchSpec(
                team_id=team_ids[0],
                provider=left_provider,
                model_name=left_model,
                reasoning_effort=left_reasoning,
            ),
            TeamMatchSpec(
                team_id=team_ids[1],
                provider=right_provider,
                model_name=right_model,
                reasoning_effort=right_reasoning,
            ),
        ]

        # One agent run per wave. After each wave, advance to plant fresh
        # flags (and the next vuln variant — services are reset to clean source
        # so agent patches don't carry over). Both teams run in parallel within
        # a wave. A fatal provider error on one side stops the peer.
        per_wave_results: list[dict[str, AgentRunResponse]] = []
        post_match_errors: list[str] = []
        for wave in range(1, num_waves + 1):
            # Make sure both services are responsive before letting agents act.
            ready_session = self.session_factory()
            try:
                ready_manager = RoundManager(
                    session=ready_session,
                    settings=self.settings,
                    runtime=self.runtime,
                    checker_executor=self.checker_executor,
                )
                try:
                    ready_manager._wait_for_services_ready(round_id)
                except Exception:
                    # If services aren't ready, agents will discover that themselves.
                    pass
            finally:
                ready_session.close()

            stop_event = threading.Event()
            wave_results: dict[str, AgentRunResponse] = {}
            with ThreadPoolExecutor(max_workers=2) as pool:
                future_to_spec = {
                    pool.submit(self._run_team, spec, stop_event): spec for spec in specs
                }
                for fut in as_completed(future_to_spec):
                    spec = future_to_spec[fut]
                    result = fut.result()
                    wave_results[spec.team_id] = result
                    if _is_fatal_error(result):
                        stop_event.set()
            per_wave_results.append(wave_results)

            # End-of-wave evaluation: run health + patch checks NOW so any
            # patch landed this wave gets credited before the next advance_wave
            # wipes the service back to clean source.
            wave_eval_session = self.session_factory()
            try:
                wave_eval_manager = RoundManager(
                    session=wave_eval_session,
                    settings=self.settings,
                    runtime=self.runtime,
                    checker_executor=self.checker_executor,
                )
                try:
                    wave_eval_manager.run_health_checks(round_id)
                except Exception as exc:
                    post_match_errors.append(redact_secrets(f"wave_{wave}_health: {type(exc).__name__}: {exc}"))
                try:
                    wave_eval_manager.run_patch_checks(round_id)
                except Exception as exc:
                    post_match_errors.append(redact_secrets(f"wave_{wave}_patch: {type(exc).__name__}: {exc}"))
            finally:
                wave_eval_session.close()

            # Advance to the next wave (plants new flags / switches variant)
            # unless this was the last wave or a fatal error already triggered.
            if wave < num_waves and not any(_is_fatal_error(r) for r in wave_results.values()):
                advance_session = self.session_factory()
                try:
                    advance_manager = RoundManager(
                        session=advance_session,
                        settings=self.settings,
                        runtime=self.runtime,
                        checker_executor=self.checker_executor,
                    )
                    try:
                        advance_manager.advance_wave(round_id)
                    except Exception:
                        # Don't blow up the match if advance fails — break out and finalize.
                        break
                finally:
                    advance_session.close()

        team_results = _merge_per_wave_results(per_wave_results, specs)

        scoreboard: list[dict] = []
        trajectory_audit_payload: dict | None = None
        final_session = self.session_factory()
        try:
            manager = RoundManager(
                session=final_session,
                settings=self.settings,
                runtime=self.runtime,
                checker_executor=self.checker_executor,
            )
            try:
                manager._wait_for_services_ready(round_id)
            except Exception as exc:
                post_match_errors.append(redact_secrets(f"service_ready: {type(exc).__name__}: {exc}"))
            try:
                manager.run_health_checks(round_id)
            except Exception as exc:
                post_match_errors.append(redact_secrets(f"health_checks: {type(exc).__name__}: {exc}"))
            try:
                manager.run_patch_checks(round_id)
            except Exception as exc:
                post_match_errors.append(redact_secrets(f"patch_checks: {type(exc).__name__}: {exc}"))
            try:
                scoreboard = manager.leaderboard(round_id)
            except Exception as exc:
                post_match_errors.append(redact_secrets(f"leaderboard: {type(exc).__name__}: {exc}"))
            try:
                trace_rows = final_session.scalars(select(TeamTrace).where(TeamTrace.round_id == round_id))
                trajectory_audit = audit_trace_rows(trace_rows)
                trajectory_audit_payload = {
                    "ok": trajectory_audit.ok,
                    "trace_count": trajectory_audit.trace_count,
                    "forbidden_event_count": trajectory_audit.forbidden_event_count,
                    "forbidden_events": [
                        {
                            "trace_id": event.trace_id,
                            "team_id": event.team_id,
                            "phase": event.phase,
                            "event_type": event.event_type,
                            "source": event.source,
                            "markers": event.markers,
                            "arguments": event.arguments,
                        }
                        for event in trajectory_audit.forbidden_events
                    ],
                    "checked_markers": list(trajectory_audit.checked_markers),
                }
            except Exception as exc:
                post_match_errors.append(redact_secrets(f"trajectory_audit: {type(exc).__name__}: {exc}"))
            try:
                manager.finalize_round(round_id)
            except Exception as exc:
                post_match_errors.append(redact_secrets(f"finalize_round: {type(exc).__name__}: {exc}"))
        finally:
            final_session.close()

        response: dict = {
            "round_id": round_id,
            "providers": {
                team_results[0].team_id: left_provider,
                team_results[1].team_id: right_provider,
            },
            "team_results": [result.model_dump() for result in team_results],
            "scoreboard": scoreboard,
            "trajectory_audit": trajectory_audit_payload,
        }
        if post_match_errors:
            response["post_match_errors"] = post_match_errors
        return response

    def _run_team(self, spec: TeamMatchSpec, stop_event: "threading.Event | None" = None) -> AgentRunResponse:
        try:
            session = self.session_factory()
            try:
                manager = RoundManager(
                    session=session,
                    settings=self.settings,
                    runtime=self.runtime,
                    checker_executor=self.checker_executor,
                )
                return manager.run_agent(
                    spec.team_id,
                    spec.provider,
                    stop_event=stop_event,
                    model_name=spec.model_name,
                    reasoning_effort=spec.reasoning_effort,
                    max_steps=self.settings.wave_max_steps,
                )
            finally:
                session.close()
        except Exception as exc:
            return AgentRunResponse(
                provider=spec.provider,
                model_name="unknown",
                team_id=spec.team_id,
                round_id=spec.team_id.rsplit("-team-", 1)[0] if "-team-" in spec.team_id else "",
                status="error",
                final_message=redact_secrets(f"{type(exc).__name__}: {exc}"),
                steps=[],
            )
