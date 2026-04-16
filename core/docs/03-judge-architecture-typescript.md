# Judge Architecture (TypeScript / Node.js)

## Design style

The judge is a **modular monolith** implemented as a TypeScript monorepo. Long-running orchestration lives in Temporal workflows. HTTP API handling, scoring, prompt assembly, and artifact publication are separate packages but share one set of contracts.

## Workspace layout

```text
apps/
  judge-api
  judge-worker
  agent-runner
  checker-runner
packages/
  contracts
  domain
  db
  integrations
  sandbox
  telemetry
  prompting
```

## Runtime responsibilities

### `judge-api`

- Exposes public, team, staff, and internal endpoints.
- Owns authentication and response shaping.
- Exposes SSE streams for leaderboard and trace updates.
- Never executes untrusted code.

### `judge-worker`

- Hosts Temporal workers and activities.
- Owns round lifecycle, provisioning, round start/stop, and publication workflows.
- Calls AWS, GitHub, and model providers through integration packages only.

### `agent-runner`

- Normalizes model-provider access.
- Builds initial team prompts.
- Talks to the per-team `arena-agentd` over mTLS.
- Emits structured trace events for all tool calls and decisions.

### `checker-runner`

- Executes checker and exploit workloads in restricted sandboxes.
- Owns queue-backed high-volume jobs such as per-wave checker fanout.
- Reports results back to the judge through internal endpoints or DB writes.

## Technology choices

- `Fastify` for HTTP APIs.
- `Zod` for runtime validation and schema sharing.
- `Temporal` for orchestrating long-lived flows.
- `Kysely` + `pg` for PostgreSQL.
- `Redis` for live leaderboard materialization and streaming fanout.
- `S3` for artifacts, logs, trace blobs, and reports.
- `BullMQ` for sandboxed checker dispatch where high queue volume matters.
- `Pino` + `OpenTelemetry` for logs and traces.

## Important boundaries

- Untrusted code must never execute in the API or worker process.
- Workflow code must remain deterministic.
- Score reconstruction must depend only on append-only `score_events`.
- Provider-specific differences must be hidden behind a stable `ModelProvider` interface.
- Team-facing tool access must be uniform across all providers.

## `arena-agentd` model

The central runner does not use raw SSH as its main abstraction. Each team VM runs a small local daemon exposing:

- `shell.exec`
- `fs.read`
- `fs.write`
- `fs.apply_patch`
- `service.restart`
- `service.status`
- `net.http`

Benefits:

- identical tool semantics across providers,
- strict quotas and timeouts,
- easy event tracing,
- safer restart and file-edit controls.

## API groups

### Public

- `GET /api/v1/rounds/current`
- `GET /api/v1/leaderboard`
- `GET /api/v1/leaderboard/stream`
- `GET /api/v1/rounds/:roundId/report`
- `GET /api/v1/rounds/:roundId/findings`

### Team

- `GET /api/v1/team/bootstrap`
- `GET /api/v1/team/targets`
- `GET /api/v1/team/services`
- `GET /api/v1/team/traces/stream`
- `POST /api/v1/flags/submit`

### Staff

- `POST /api/v1/admin/rounds`
- `POST /api/v1/admin/rounds/:id/start`
- `POST /api/v1/admin/rounds/:id/pause`
- `POST /api/v1/admin/rounds/:id/abort`
- `POST /api/v1/admin/teams/:id/quarantine`
- `POST /api/v1/admin/submissions/:id/replay`

### Internal

- `POST /internal/traces/batch`
- `POST /internal/checker-results`
- `POST /internal/provisioning-events`
- `POST /internal/agent-heartbeats`

## Code-level package contracts

### `packages/contracts`

- Zod schemas for routes, entities, and events.
- Shared types for flags, rounds, findings, traces, and score events.
- API DTOs shared by apps and workers.

### `packages/domain`

- scoring rules,
- repo selection policy,
- round invariants,
- flag encoding and validation helpers,
- prompt-safe business rules.

### `packages/db`

- Kysely database types,
- migrations,
- repository functions,
- transaction helpers.

### `packages/integrations`

- AWS clients and orchestration helpers,
- runtime backend abstraction and implementations,
- GitHub publication helpers,
- model-provider abstraction and adapters.

### `packages/sandbox`

- checker job specs,
- runtime limits,
- sandbox result normalization.

### `packages/telemetry`

- trace event shapes,
- redaction pipeline,
- stream formatting.

### `packages/prompting`

- team prompt renderer,
- system policy blocks,
- provider-agnostic tool descriptions.

## Deployment notes

- Run API, worker, agent runner, and checker runner as separate workloads.
- Keep PostgreSQL and Redis managed and isolated from team VPCs.
- Store large traces and artifacts in S3, not in PostgreSQL.
- Use KMS-derived per-round keys for flag HMAC generation and token signing.

## Execution backends

The judge must not assume EC2 is the only way to run a round. The control plane selects a runtime backend per round and passes that choice through the round bundle.

### `aws-ec2`

- Production backend.
- One AWS account per team.
- Strongest isolation and closest to the intended public benchmark environment.

### `docker-local`

- Development and rehearsal backend.
- One long-lived Docker network per round.
- One Ubuntu-based container per team on the same network.
- The judge, agent runner, and team containers can share the same Docker bridge network for local testing.
- Lower isolation than AWS, so use it for local iteration, CI smoke tests, and internal dry-runs rather than the main public leaderboard.

### Backend boundary

The worker talks to a `CompetitionRuntimeBackend` abstraction with two required operations:

- `provisionRound`
- `destroyRound`

This keeps round generation, scoring, and agent orchestration backend-agnostic.
