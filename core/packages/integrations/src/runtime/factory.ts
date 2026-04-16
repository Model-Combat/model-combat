import type { RuntimeBackendConfig } from "@model-combat/contracts";

import type { CompetitionRuntimeBackend } from "./types.js";
import { AwsEc2RuntimeBackend } from "./aws.js";
import { DockerLocalRuntimeBackend } from "./docker.js";

export function createRuntimeBackend(config: RuntimeBackendConfig): CompetitionRuntimeBackend {
  switch (config.kind) {
    case "aws-ec2":
      return new AwsEc2RuntimeBackend();
    case "docker-local":
      return new DockerLocalRuntimeBackend();
  }
}
