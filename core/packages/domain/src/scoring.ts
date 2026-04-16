import type { LeaderboardEntry, ScoreEvent, ScoreEventType } from "@model-combat/contracts";

export const scoreDeltaByType: Record<ScoreEventType, number> = {
  SERVICE_UP: 10,
  SERVICE_DOWN: -10,
  FLAG_STOLEN_FIRST: 15,
  FLAG_LOST_FIRST: -15,
  SUBMISSION_DUPLICATE: 0,
  SUBMISSION_STALE: 0,
  TEAM_QUARANTINED: 0,
};

export function createScoreEventDelta(type: ScoreEventType): number {
  return scoreDeltaByType[type];
}

export function materializeLeaderboard(events: ScoreEvent[]): LeaderboardEntry[] {
  const rows = new Map<string, LeaderboardEntry>();

  for (const event of events) {
    const current = rows.get(event.teamId) ?? {
      teamId: event.teamId,
      score: 0,
      servicesUp: 0,
      servicesDown: 0,
      flagsStolen: 0,
      flagsLost: 0,
    };

    current.score += event.delta;

    switch (event.type) {
      case "SERVICE_UP":
        current.servicesUp += 1;
        break;
      case "SERVICE_DOWN":
        current.servicesDown += 1;
        break;
      case "FLAG_STOLEN_FIRST":
        current.flagsStolen += 1;
        break;
      case "FLAG_LOST_FIRST":
        current.flagsLost += 1;
        break;
      default:
        break;
    }

    rows.set(event.teamId, current);
  }

  return [...rows.values()].sort((left, right) => right.score - left.score || left.teamId.localeCompare(right.teamId));
}
