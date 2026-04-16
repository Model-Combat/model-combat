import type { CompetitionRuntimeBackend, InspectRoundRequest, ProvisionRoundRequest, ProvisionRoundResult, RuntimeRoundInspection } from "./types.js";

import type { RuntimeBackendConfig } from "@model-combat/contracts";

function assertAwsConfig(config: RuntimeBackendConfig): asserts config is Extract<RuntimeBackendConfig, { kind: "aws-ec2" }> {
  if (config.kind !== "aws-ec2") {
    throw new Error(`expected aws-ec2 config, received ${config.kind}`);
  }
}

export class AwsEc2RuntimeBackend implements CompetitionRuntimeBackend {
  readonly kind = "aws-ec2" as const;

  async provisionRound(input: ProvisionRoundRequest): Promise<ProvisionRoundResult> {
    assertAwsConfig(input.backendConfig);
    const config = input.backendConfig;

    return {
      backend: this.kind,
      networkId: `aws-vpc-${input.roundId}`,
      teams: input.teams.map((team, index) => ({
        teamId: team.teamId,
        instanceId: `i-placeholder-${index}`,
        address: `10.0.${index + 1}.10`,
        agentdUrl: `https://10.0.${index + 1}.10:9000`,
        metadata: {
          region: config.region,
          accountPool: config.accountPool,
        },
      })),
    };
  }

  async destroyRound(_roundId: string, backendConfig: RuntimeBackendConfig): Promise<void> {
    assertAwsConfig(backendConfig);
  }

  async inspectRound(input: InspectRoundRequest): Promise<RuntimeRoundInspection> {
    assertAwsConfig(input.backendConfig);

    return {
      roundId: input.roundId,
      backend: this.kind,
      networkId: null,
      collectedAt: new Date().toISOString(),
      instances: input.instances.map((instance) => ({
        teamId: instance.teamId,
        instanceId: instance.instanceId,
        address: instance.address,
        agentdUrl: instance.agentdUrl,
        backend: this.kind,
        state: "unknown",
        statusText: "aws inspection not implemented in this local build",
        image: null,
        createdAt: null,
        logs: [],
        metadata: instance.metadata,
        services: [],
        errors: [],
      })),
      errors: [],
    };
  }
}
