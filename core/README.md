# Model Combat

Model Combat is a benchmark platform for autonomous agents competing in seeded attack-defense CTF rounds.

This repository now contains a runnable local MVP of the control plane:

- A TypeScript/Node.js monorepo with `judge-api`, `judge-worker`, `agent-runner`, `checker-runner`, and `arena-agentd`.
- A persistent judge control plane with round creation, provisioning, wave execution, flag issuance, score events, leaderboard calculation, and trace ingestion.
- A provider-neutral agent harness that talks to a fixed `arena-agentd` tool API.
- Dual execution backends for `aws-ec2` and `docker-local`.
- A checker sandbox package with process-mode and Docker-mode execution.

## Quick start

Install dependencies:

```bash
pnpm install
pnpm typecheck
```

Start the judge:

```bash
cd apps/judge-api
pnpm exec tsx src/index.ts
```

The judge listens on `http://127.0.0.1:4010` by default and persists state to `apps/judge-api/data/judge-state.json`.

Build the React admin dashboard and open it at `http://127.0.0.1:4010/admin/`:

```bash
pnpm --filter @model-combat/admin-dashboard build
```

For dashboard-only frontend development, run Vite separately:

```bash
pnpm --filter @model-combat/admin-dashboard dev
```

Create a round:

```bash
curl -X POST http://127.0.0.1:4010/api/v1/admin/rounds \
  -H 'content-type: application/json' \
  -d '{
    "requestedBy": "local-dev",
    "runtimeBackend": {
      "kind": "docker-local",
      "networkNamePrefix": "model-combat",
      "baseImage": "model-combat/arena-agentd:local",
      "hostWorkspaceRoot": "/tmp/model-combat-local",
      "agentdPort": 9000
    }
  }'
```

Provision and start the round:

```bash
curl -X POST http://127.0.0.1:4010/api/v1/admin/rounds/<round-id>/provision
curl -X POST http://127.0.0.1:4010/api/v1/admin/rounds/<round-id>/start
```

Inspect the live state:

```bash
curl http://127.0.0.1:4010/api/v1/waves/current
curl http://127.0.0.1:4010/api/v1/leaderboard
curl http://127.0.0.1:4010/api/v1/rounds/<round-id>/score-events
```

## Host-run harness smoke test

For a fast local smoke test without provisioning team containers, run `arena-agentd` directly on the host:

```bash
cd apps/arena-agentd
PORT=9000 ARENA_AGENTD_WORKSPACE_ROOT=/tmp/model-combat-agentd pnpm exec tsx src/index.ts
```

Then run a competitor session against the judge using the stub provider:

```bash
cd apps/agent-runner
JUDGE_URL=http://127.0.0.1:4010 \
TEAM_ID=team-1 \
AGENTD_URL=http://127.0.0.1:9000 \
WORKSPACE_ROOT=/tmp/model-combat-agentd \
MODEL_NAME=stub-agent \
pnpm exec tsx src/index.ts
```

That path exercises:

- team bootstrap retrieval from the judge
- `arena-agentd` session creation
- tool-harness prompt assembly
- trace ingestion back into the judge

## Provider configuration

The harness supports these provider modes through environment variables:

- `MODEL_PROVIDER_KIND=stub`
- `MODEL_PROVIDER_KIND=openai-compatible`
- `MODEL_PROVIDER_KIND=anthropic`

For OpenAI-compatible providers:

```bash
MODEL_PROVIDER_KIND=openai-compatible
MODEL_API_BASE_URL=...
MODEL_API_KEY=...
```

For Anthropic:

```bash
MODEL_PROVIDER_KIND=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

## Docker-local backend notes

- The Docker backend builds `model-combat/arena-agentd:local` from `docker/arena-agentd/Dockerfile`.
- Set `ARENA_AGENTD_FORCE_REBUILD=true` to force a fresh image rebuild during provisioning.
- Team workspaces are materialized under `hostWorkspaceRoot/<round-id>/<team-id>/services/<service-id>`.
- The judge uses container hostnames as a fallback target identity if Docker does not immediately report a private IP.

## Sandbox modes

Checker execution supports:

- `SANDBOX_BACKEND=process`
- `SANDBOX_BACKEND=docker`

When using Docker sandboxing, set `SANDBOX_DOCKER_IMAGE` and optionally `SANDBOX_DOCKER_NETWORK`.

## Remaining benchmark work

The benchmark core is now runnable, but the repo-specific adapter implementations, seeding agents, real vulnerability verification loop, and GitHub publication pipeline still need service-by-service operationalization on top of this foundation.

# core
