import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

type Timestamp = Date;
type JsonColumn<T> = ColumnType<T, T, T>;

export interface RepoPoolEntriesTable {
  service_id: string;
  display_name: string;
  upstream_url: string;
  bucket: string;
  license: string;
  protocol: string;
  port: number;
  qualification_status: string;
  why_included: string;
  adapter_shape: string;
  source_urls: JsonColumn<string[]>;
  created_at: Generated<Timestamp>;
}

export interface ServiceTemplatesTable {
  service_id: string;
  round_id: string;
  port: number;
  build_cmd: string;
  start_cmd: string;
  check_path: string;
  put_flag_path: string;
  get_flag_path: string;
  artifact_paths: JsonColumn<string[]>;
  seed_constraints: JsonColumn<string[]>;
  resource_limits: JsonColumn<{ cpuShares: number; memoryMb: number; timeoutSeconds: number }>;
  created_at: Generated<Timestamp>;
}

export interface RoundsTable {
  round_id: string;
  status: string;
  judge_config: JsonColumn<{ roundDurationMinutes: number; waveDurationMinutes: number; flagTtlWaves: number }>;
  runtime_backend: JsonColumn<Record<string, unknown>>;
  runtime_image_ref: string;
  digest: string;
  created_at: Generated<Timestamp>;
}

export interface RoundModelsTable {
  id: Generated<number>;
  round_id: string;
  slot: number;
  provider: string;
  model: string;
  role: string;
}

export interface FindingsTable {
  finding_id: string;
  round_id: string;
  service_id: string;
  author_model: string;
  verifier_model: string;
  title: string;
  category: string;
  leak_target: string;
  exploit_path: string;
  exploit_success_rate: number;
  patch_expectation: string;
  status: string;
  created_at: Generated<Timestamp>;
}

export interface VerifierRunsTable {
  id: Generated<number>;
  finding_id: string;
  accepted: boolean;
  replay_count: number;
  notes: string;
  created_at: Generated<Timestamp>;
}

export interface RoundBundlesTable {
  round_id: string;
  bundle_ref: string;
  digest: string;
  created_at: Generated<Timestamp>;
}

export interface TeamsTable {
  team_id: string;
  display_name: string;
  account_id: string;
  created_at: Generated<Timestamp>;
}

export interface TeamInstancesTable {
  id: Generated<number>;
  round_id: string;
  team_id: string;
  account_id: string;
  backend_kind: string;
  network_id: string;
  instance_id: string;
  private_ip: string;
  agentd_url: string;
  status: string;
  created_at: Generated<Timestamp>;
}

export interface WavesTable {
  id: Generated<number>;
  round_id: string;
  wave_number: number;
  started_at: Timestamp;
  ended_at: Timestamp | null;
  status: string;
}

export interface FlagsTable {
  flag_id: string;
  round_id: string;
  team_id: string;
  service_id: string;
  wave: number;
  issued_at: Timestamp;
  expires_at: Timestamp;
  status: string;
  first_stolen_by: string | null;
  validation_tag: string;
}

export interface SubmissionsTable {
  submission_id: string;
  round_id: string;
  team_id: string;
  flag_id: string | null;
  submitted_flag: string;
  status: string;
  created_at: Generated<Timestamp>;
}

export interface ScoreEventsTable {
  event_id: string;
  round_id: string;
  team_id: string;
  service_id: string;
  wave: number;
  type: string;
  delta: number;
  related_team_id: string | null;
  flag_id: string | null;
  submission_id: string | null;
  trace_span_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface AgentSessionsTable {
  session_id: string;
  round_id: string;
  team_id: string;
  provider: string;
  model: string;
  started_at: Generated<Timestamp>;
  ended_at: Timestamp | null;
}

export interface TraceSpansTable {
  span_id: string;
  round_id: string;
  team_id: string;
  phase: string;
  parent_span_id: string | null;
  started_at: Timestamp;
  ended_at: Timestamp | null;
  redaction_state: string;
}

export interface TraceChunksTable {
  id: Generated<number>;
  span_id: string;
  chunk_index: number;
  payload_ref: string;
}

export interface CheckerRunsTable {
  job_id: string;
  round_id: string;
  team_id: string;
  service_id: string;
  kind: string;
  success: boolean;
  exit_code: number;
  stdout_ref: string;
  stderr_ref: string;
  started_at: Timestamp;
  finished_at: Timestamp;
}

export interface ArtifactsTable {
  artifact_id: string;
  round_id: string;
  kind: string;
  storage_ref: string;
  metadata: JsonColumn<Record<string, unknown>>;
  created_at: Generated<Timestamp>;
}

export interface ReportsTable {
  report_id: string;
  round_id: string;
  summary_ref: string;
  created_at: Generated<Timestamp>;
}

export interface DatabaseSchema {
  repo_pool_entries: RepoPoolEntriesTable;
  service_templates: ServiceTemplatesTable;
  rounds: RoundsTable;
  round_models: RoundModelsTable;
  findings: FindingsTable;
  verifier_runs: VerifierRunsTable;
  round_bundles: RoundBundlesTable;
  teams: TeamsTable;
  team_instances: TeamInstancesTable;
  waves: WavesTable;
  flags: FlagsTable;
  submissions: SubmissionsTable;
  score_events: ScoreEventsTable;
  agent_sessions: AgentSessionsTable;
  trace_spans: TraceSpansTable;
  trace_chunks: TraceChunksTable;
  checker_runs: CheckerRunsTable;
  artifacts: ArtifactsTable;
  reports: ReportsTable;
}

export type RepoPoolEntryRow = Selectable<RepoPoolEntriesTable>;
export type InsertRepoPoolEntryRow = Insertable<RepoPoolEntriesTable>;
export type UpdateRepoPoolEntryRow = Updateable<RepoPoolEntriesTable>;
export type ScoreEventRow = Selectable<ScoreEventsTable>;
export type InsertScoreEventRow = Insertable<ScoreEventsTable>;
