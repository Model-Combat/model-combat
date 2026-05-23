from __future__ import annotations

from apscheduler.schedulers.background import BackgroundScheduler

from model_combat.domain.service import RoundManager


class SchedulerService:
    def __init__(self, round_manager_factory) -> None:
        self._round_manager_factory = round_manager_factory
        self._scheduler = BackgroundScheduler()

    @property
    def scheduler(self) -> BackgroundScheduler:
        return self._scheduler

    def start(self) -> None:
        if not self._scheduler.running:
            self._scheduler.start()

    def stop(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)

    def schedule_round(self, round_id: str, wave_duration_seconds: int) -> None:
        self._scheduler.add_job(
            self._tick_round,
            "interval",
            seconds=wave_duration_seconds,
            id=f"round-wave-{round_id}",
            replace_existing=True,
            kwargs={"round_id": round_id},
        )

    def unschedule_round(self, round_id: str) -> None:
        job_id = f"round-wave-{round_id}"
        if self._scheduler.get_job(job_id):
            self._scheduler.remove_job(job_id)

    def _tick_round(self, round_id: str) -> None:
        manager: RoundManager = self._round_manager_factory()
        try:
            manager.run_health_checks(round_id)
            manager.run_patch_checks(round_id)
            manager.advance_wave(round_id)
        finally:
            manager.session.close()
