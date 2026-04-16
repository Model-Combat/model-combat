import type { Finding, RepoPoolEntry, RoundBundle, RuntimeBackendConfig, RuntimeServiceSpec, ServiceTemplate } from "@model-combat/contracts";

import { buildRoundBundle, selectRoundRepoPool } from "@model-combat/domain";
import { createRuntimeBackend } from "@model-combat/integrations";

export async function qualifyRepoTemplate(serviceId: string): Promise<{ serviceId: string; qualified: boolean }> {
  return {
    serviceId,
    qualified: true,
  };
}

export async function createRound(): Promise<RoundBundle> {
  const services = selectRoundRepoPool();

  return buildRoundBundle({
    roundId: `round-${Date.now()}`,
    seedModels: [
      { slot: 0, provider: "openai", model: "gpt-5", role: "seed" },
      { slot: 1, provider: "anthropic", model: "claude-opus", role: "verify" },
    ],
    competitorRoster: [
      { slot: 0, provider: "openai", model: "gpt-5", role: "competitor" },
      { slot: 1, provider: "anthropic", model: "claude-opus", role: "competitor" },
      { slot: 2, provider: "deepseek", model: "deepseek-reasoner", role: "competitor" },
    ],
    services,
    seededRepoRefs: services.map((service) => `github://live/${service.serviceId}`),
    findingManifestRefs: [],
    verifierResults: [],
    runtimeBackend: {
      kind: "aws-ec2",
      region: process.env.AWS_REGION ?? "us-east-1",
      accountPool: [],
    },
    runtimeImageRef: "ami-placeholder",
    digest: "digest-placeholder",
  });
}

export async function seedRepo(service: RepoPoolEntry): Promise<Finding[]> {
  return [
    {
      findingId: `${service.serviceId}-finding-1`,
      roundId: "round-placeholder",
      serviceId: service.serviceId,
      authorModel: "gpt-5",
      verifierModel: "claude-opus",
      title: `Seeded issue for ${service.displayName}`,
      category: "authz",
      leakTarget: "private content",
      exploitPath: "exploit/replay.py",
      exploitSuccessRate: 1,
      patchExpectation: "tighten object-level authorization checks",
      status: "candidate",
    },
  ];
}

export async function verifyFinding(finding: Finding): Promise<{ findingId: string; accepted: boolean }> {
  return {
    findingId: finding.findingId,
    accepted: true,
  };
}

export async function freezeRoundBundle(round: RoundBundle): Promise<{ roundId: string; digest: string }> {
  return {
    roundId: round.roundId,
    digest: round.digest,
  };
}

export async function publishRoundRepos(roundId: string): Promise<{ roundId: string; published: boolean }> {
  return {
    roundId,
    published: true,
  };
}

export async function provisionTeams(args: {
  roundId: string;
  runtimeBackend: RuntimeBackendConfig;
  services: RuntimeServiceSpec[];
}): Promise<{ roundId: string; teamsProvisioned: number; backend: RuntimeBackendConfig["kind"] }> {
  const runtimeBackend = createRuntimeBackend(args.runtimeBackend);
  const provisioned = await runtimeBackend.provisionRound({
    roundId: args.roundId,
    judgeUrl: process.env.JUDGE_URL ?? "https://judge.internal/api/v1",
    backendConfig: args.runtimeBackend,
    teams: Array.from({ length: 10 }, (_, index) => ({
      teamId: `team-${index + 1}`,
      hostname: `team-${index + 1}`,
      workspacePath: "/srv/model-combat",
      services: args.services,
    })),
  });

  return {
    roundId: args.roundId,
    teamsProvisioned: provisioned.teams.length,
    backend: provisioned.backend,
  };
}

export async function runRound(roundId: string): Promise<{ roundId: string; wavesExecuted: number }> {
  return {
    roundId,
    wavesExecuted: 12,
  };
}

export async function finalizeRound(roundId: string): Promise<{ roundId: string; finalized: boolean }> {
  return {
    roundId,
    finalized: true,
  };
}
