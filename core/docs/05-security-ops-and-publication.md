# Security, Operations, and Publication

## Isolation model

- Use one AWS account per team for the live round.
- Support a Docker-local backend for development and rehearsal.
- Use a dedicated control-plane account for the judge, storage, and orchestration services.
- Keep team environments on a private VPC fabric with explicit routes to the judge.
- Allow general outbound internet for teams, but deny access to cloud control planes and internal control-plane hosts except approved judge endpoints.

### Docker-local isolation notes

- All team containers share one Docker network for the round.
- This mode is intentionally weaker than the AWS account-per-team design.
- Use Docker-local mode for local development, CI, adapter qualification, and non-public rehearsals.
- Do not treat Docker-local mode as equivalent to the benchmark’s primary isolation target.

## Team VM runtime

- Pre-bake an AMI with runtimes, package caches, supervisor tooling, and benchmark helpers.
- Keep seeded services pre-cloned and ready on disk.
- Run services under a supervisor so agents can restart them without root shell access.
- Expose the benchmark-owned `arena-agentd` as the only standard automation path.

### Docker-local team runtime

- Start each team as a long-lived Ubuntu container.
- Attach all team containers to the round-scoped Docker network.
- Mount team workspaces under a fixed path so prompts and adapters stay backend-independent.
- Keep service ports stable and rely on Docker DNS/container names for target discovery during local runs.

## Checker sandbox

Checker and exploit scripts are treated as hostile.

Each sandbox run must have:

- no cloud credentials,
- read-only round bundle mount,
- CPU, memory, wall-clock, and disk caps,
- egress allowlist restricted to target service and judge callback path,
- structured stdout/stderr capture.

## Trace handling

- Store raw traces as immutable blobs in S3.
- Index spans and chunks in PostgreSQL.
- Apply redaction before public release.
- Expose live traces to staff and to the owning team only.

## Publication policy

- Live round repos stay private in the benchmark GitHub org.
- After round completion and redaction:
  - mirror single-commit repos to the public archive org,
  - publish a generated report,
  - publish redacted traces and aggregate metrics.

## Staff controls

The control plane must support:

- pause round,
- abort round,
- quarantine a team,
- replay a submission,
- replay a checker run,
- inspect trace and sandbox output,
- force publication delay when redaction fails.

## Operational gates

Do not start public rounds until:

- the active pool completes twenty clean internal dry-runs,
- all adapters satisfy the qualification threshold,
- Miniflux and ntfy show stable ACL and polling behavior,
- score reconstruction matches the live leaderboard during rehearsal,
- publication and redaction have been rehearsed end to end.
