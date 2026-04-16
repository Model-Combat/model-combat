CREATE TABLE repo_pool_entries (
  service_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  upstream_url TEXT NOT NULL,
  bucket TEXT NOT NULL,
  license TEXT NOT NULL,
  protocol TEXT NOT NULL,
  port INTEGER NOT NULL,
  qualification_status TEXT NOT NULL,
  why_included TEXT NOT NULL,
  adapter_shape TEXT NOT NULL,
  source_urls JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE service_templates (
  service_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  port INTEGER NOT NULL,
  build_cmd TEXT NOT NULL,
  start_cmd TEXT NOT NULL,
  check_path TEXT NOT NULL,
  put_flag_path TEXT NOT NULL,
  get_flag_path TEXT NOT NULL,
  artifact_paths JSONB NOT NULL,
  seed_constraints JSONB NOT NULL,
  resource_limits JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (service_id, round_id)
);

CREATE TABLE rounds (
  round_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  judge_config JSONB NOT NULL,
  runtime_backend JSONB NOT NULL,
  runtime_image_ref TEXT NOT NULL,
  digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE round_models (
  id BIGSERIAL PRIMARY KEY,
  round_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL
);

CREATE TABLE findings (
  finding_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  author_model TEXT NOT NULL,
  verifier_model TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  leak_target TEXT NOT NULL,
  exploit_path TEXT NOT NULL,
  exploit_success_rate DOUBLE PRECISION NOT NULL,
  patch_expectation TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE verifier_runs (
  id BIGSERIAL PRIMARY KEY,
  finding_id TEXT NOT NULL,
  accepted BOOLEAN NOT NULL,
  replay_count INTEGER NOT NULL,
  notes TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE round_bundles (
  round_id TEXT PRIMARY KEY,
  bundle_ref TEXT NOT NULL,
  digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teams (
  team_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE team_instances (
  id BIGSERIAL PRIMARY KEY,
  round_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  backend_kind TEXT NOT NULL,
  network_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  private_ip TEXT NOT NULL,
  agentd_url TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE waves (
  id BIGSERIAL PRIMARY KEY,
  round_id TEXT NOT NULL,
  wave_number INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL
);

CREATE TABLE flags (
  flag_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  wave INTEGER NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  first_stolen_by TEXT,
  validation_tag TEXT NOT NULL
);

CREATE TABLE submissions (
  submission_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  flag_id TEXT,
  submitted_flag TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE score_events (
  event_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  wave INTEGER NOT NULL,
  type TEXT NOT NULL,
  delta INTEGER NOT NULL,
  related_team_id TEXT,
  flag_id TEXT,
  submission_id TEXT,
  trace_span_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_sessions (
  session_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE trace_spans (
  span_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  parent_span_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  redaction_state TEXT NOT NULL
);

CREATE TABLE trace_chunks (
  id BIGSERIAL PRIMARY KEY,
  span_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload_ref TEXT NOT NULL
);

CREATE TABLE checker_runs (
  job_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  exit_code INTEGER NOT NULL,
  stdout_ref TEXT NOT NULL,
  stderr_ref TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  storage_ref TEXT NOT NULL,
  metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reports (
  report_id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  summary_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
