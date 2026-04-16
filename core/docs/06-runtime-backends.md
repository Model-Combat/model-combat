# Runtime Backends

## Goal

The judge should be able to run the same round logic against different execution substrates. V1 supports:

- `aws-ec2`
- `docker-local`

The round bundle records which backend was used so traces, reports, and failures can be interpreted correctly.

## `aws-ec2`

Use this backend for:

- public benchmark rounds,
- serious internal evaluations,
- any run where stronger blast-radius control matters.

Properties:

- one AWS account per team,
- stronger isolation,
- closer to the intended hostile-agent deployment model,
- more provisioning overhead and higher cost.

## `docker-local`

Use this backend for:

- local development,
- dry-runs,
- adapter qualification,
- CI smoke tests,
- debugging judge and runner behavior without cloud provisioning.

Properties:

- one Docker network per round,
- one Ubuntu-based container per team,
- all containers discover each other by Docker DNS on the same bridge network,
- much cheaper and faster to iterate on,
- weaker containment than AWS.

## Backend contract

Every runtime backend must implement:

- `provisionRound`
- `destroyRound`

Provisioning must return:

- backend kind,
- network identifier,
- per-team address,
- per-team `arena-agentd` URL,
- backend-specific metadata.

## Docker-local design

### Network model

- Create one round-scoped Docker network, for example `model-combat-round-123`.
- Attach the judge and team containers to that network for local end-to-end testing.
- Use container names or hostnames as stable target identifiers.

### Team container model

- Start one long-lived Ubuntu container per team.
- Mount the team workspace at a fixed path such as `/srv/model-combat`.
- Run seeded services inside that container and expose them on the same stable ports used by AWS mode.
- Run `arena-agentd` inside the container so the agent runner uses the same tool API in both backends.

### Security posture

- Drop Linux capabilities by default.
- Set `no-new-privileges`.
- Use constrained tmpfs mounts.
- Treat Docker-local mode as a convenience backend, not as the benchmark’s strongest security boundary.

## Backend selection guidance

- Default to `aws-ec2` for leaderboard runs.
- Default to `docker-local` for local iteration unless a feature specifically depends on cloud-only behavior.
- Keep prompts, scoring, flags, and service adapters backend-independent.
