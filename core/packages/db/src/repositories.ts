import type { Kysely } from "kysely";

import type { Finding, ScoreEvent } from "@model-combat/contracts";

import type { DatabaseSchema, InsertScoreEventRow, RepoPoolEntryRow } from "./schema.js";

export async function listQualifiedRepoPoolEntries(db: Kysely<DatabaseSchema>): Promise<RepoPoolEntryRow[]> {
  return db
    .selectFrom("repo_pool_entries")
    .selectAll()
    .where("qualification_status", "=", "qualified")
    .orderBy("bucket asc")
    .orderBy("display_name asc")
    .execute();
}

export async function insertScoreEvent(db: Kysely<DatabaseSchema>, event: ScoreEvent): Promise<void> {
  const row: InsertScoreEventRow = {
    event_id: event.eventId,
    round_id: event.roundId,
    team_id: event.teamId,
    service_id: event.serviceId,
    wave: event.wave,
    type: event.type,
    delta: event.delta,
    related_team_id: event.relatedTeamId,
    flag_id: event.flagId,
    submission_id: event.submissionId,
    trace_span_id: event.traceSpanId,
    created_at: new Date(event.createdAt),
  };

  await db.insertInto("score_events").values(row).execute();
}

export async function getRoundScoreEvents(db: Kysely<DatabaseSchema>, roundId: string): Promise<ScoreEvent[]> {
  const rows = await db
    .selectFrom("score_events")
    .selectAll()
    .where("round_id", "=", roundId)
    .orderBy("created_at asc")
    .execute();

  return rows.map((row) => ({
    eventId: row.event_id,
    roundId: row.round_id,
    teamId: row.team_id,
    serviceId: row.service_id,
    wave: row.wave,
    type: row.type as ScoreEvent["type"],
    delta: row.delta,
    relatedTeamId: row.related_team_id,
    flagId: row.flag_id,
    submissionId: row.submission_id,
    traceSpanId: row.trace_span_id,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function getRoundFindings(db: Kysely<DatabaseSchema>, roundId: string): Promise<Finding[]> {
  const rows = await db
    .selectFrom("findings")
    .selectAll()
    .where("round_id", "=", roundId)
    .orderBy("service_id asc")
    .execute();

  return rows.map((row) => ({
    findingId: row.finding_id,
    roundId: row.round_id,
    serviceId: row.service_id,
    authorModel: row.author_model,
    verifierModel: row.verifier_model,
    title: row.title,
    category: row.category,
    leakTarget: row.leak_target,
    exploitPath: row.exploit_path,
    exploitSuccessRate: row.exploit_success_rate,
    patchExpectation: row.patch_expectation,
    status: row.status as Finding["status"],
  }));
}
