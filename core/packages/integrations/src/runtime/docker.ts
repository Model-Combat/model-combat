import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import type {
  CompetitionRuntimeBackend,
  InspectRoundRequest,
  ProvisionRoundRequest,
  ProvisionRoundResult,
  ProvisionedTeamInstance,
  RuntimeInstanceInspection,
  RuntimeRoundInspection,
} from "./types.js";

import type { RuntimeBackendConfig } from "@model-combat/contracts";

const execFileAsync = promisify(execFile);
const localArenaAgentdImage = "model-combat/arena-agentd:local";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

function assertDockerConfig(
  config: RuntimeBackendConfig,
): asserts config is Extract<RuntimeBackendConfig, { kind: "docker-local" }> {
  if (config.kind !== "docker-local") {
    throw new Error(`expected docker-local config, received ${config.kind}`);
  }
}

function normalizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").toLowerCase();
}

export class DockerLocalRuntimeBackend implements CompetitionRuntimeBackend {
  readonly kind = "docker-local" as const;

  async provisionRound(input: ProvisionRoundRequest): Promise<ProvisionRoundResult> {
    assertDockerConfig(input.backendConfig);
    await this.ensureBaseImage(input.backendConfig.baseImage);

    const networkName = `${normalizeName(input.backendConfig.networkNamePrefix)}-${normalizeName(input.roundId)}`;
    await this.ensureNetwork(networkName);

    const teams: ProvisionedTeamInstance[] = [];
    for (const team of input.teams) {
      teams.push(
        await this.ensureTeamContainer(input, networkName, team.teamId, team.hostname, team.workspacePath, team.services),
      );
    }

    return {
      backend: this.kind,
      networkId: networkName,
      teams,
    };
  }

  async destroyRound(roundId: string, backendConfig: RuntimeBackendConfig): Promise<void> {
    assertDockerConfig(backendConfig);

    const networkName = `${normalizeName(backendConfig.networkNamePrefix)}-${normalizeName(roundId)}`;
    const { stdout } = await execFileAsync("docker", [
      "ps",
      "-a",
      "--filter",
      `label=model-combat.round-id=${roundId}`,
      "--format",
      "{{.Names}}",
    ]);

    const containers = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const container of containers) {
      await execFileAsync("docker", ["rm", "-f", container]);
    }

    await execFileAsync("docker", ["network", "rm", networkName]).catch(() => undefined);
  }

  async inspectRound(input: InspectRoundRequest): Promise<RuntimeRoundInspection> {
    assertDockerConfig(input.backendConfig);

    const instances: RuntimeInstanceInspection[] = [];
    const errors: string[] = [];

    for (const instance of input.instances) {
      instances.push(await this.inspectContainerInstance(instance, input.tailLines ?? 80));
    }

    const networkId = typeof input.instances[0]?.metadata.networkId === "string"
      ? input.instances[0].metadata.networkId
      : null;

    return {
      roundId: input.roundId,
      backend: this.kind,
      networkId,
      collectedAt: new Date().toISOString(),
      instances,
      errors,
    };
  }

  private async ensureNetwork(networkName: string): Promise<void> {
    const { stdout } = await execFileAsync("docker", ["network", "ls", "--format", "{{.Name}}"]);
    const networks = stdout.split("\n").map((line) => line.trim());
    if (networks.includes(networkName)) {
      return;
    }

    await execFileAsync("docker", ["network", "create", networkName]);
  }

  private async ensureTeamContainer(
    input: ProvisionRoundRequest,
    networkName: string,
    teamId: string,
    hostname: string,
    workspacePath: string,
    services: ProvisionRoundRequest["teams"][number]["services"],
  ): Promise<ProvisionedTeamInstance> {
    assertDockerConfig(input.backendConfig);

    const containerName = normalizeName(`${input.roundId}-${teamId}`);
    const authToken = createHash("sha256").update(`${input.roundId}:${teamId}`).digest("hex");
    const { stdout } = await execFileAsync("docker", [
      "ps",
      "-a",
      "--filter",
      `name=^/${containerName}$`,
      "--format",
      "{{.Names}}",
    ]);

    if (!stdout.trim()) {
      const hostTeamRoot = input.backendConfig.hostWorkspaceRoot
        ? resolve(input.backendConfig.hostWorkspaceRoot, input.roundId, teamId)
        : null;

      if (hostTeamRoot) {
        await this.prepareHostWorkspace(hostTeamRoot, input.roundId, teamId, services);
      }

      const runArgs = [
        "run",
        "-d",
        "--name",
        containerName,
        "--hostname",
        hostname,
        "--network",
        networkName,
        "--label",
        `model-combat.round-id=${input.roundId}`,
        "--label",
        `model-combat.team-id=${teamId}`,
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=256m",
        "-e",
        `PORT=${input.backendConfig.agentdPort}`,
        "-e",
        `ARENA_AGENTD_AUTH_TOKEN=${authToken}`,
        "-e",
        `ARENA_AGENTD_WORKSPACE_ROOT=${workspacePath}`,
        "-e",
        `ARENA_AGENTD_TEAM_ID=${teamId}`,
        "-e",
        `ARENA_AGENTD_ROUND_ID=${input.roundId}`,
        "-e",
        `ARENA_AGENTD_SERVICES_JSON=${JSON.stringify(services)}`,
        "-e",
        "ARENA_AGENTD_AUTO_START=true",
      ];

      if (input.backendConfig.hostWorkspaceRoot) {
        runArgs.push(
          "-v",
          `${hostTeamRoot}:${workspacePath}`,
        );
      }

      runArgs.push(
        input.backendConfig.baseImage,
      );

      await execFileAsync("docker", runArgs);
      const address = await this.inspectContainerIp(containerName);

      return {
        teamId,
        instanceId: containerName,
        address,
        agentdUrl: `http://${containerName}:${input.backendConfig.agentdPort}`,
        metadata: {
          networkName,
          baseImage: input.backendConfig.baseImage,
          hostname,
          authToken,
        },
      };
    } else {
      await execFileAsync("docker", ["start", containerName]).catch(() => undefined);
    }

    const address = await this.inspectContainerIp(containerName);

    return {
      teamId,
      instanceId: containerName,
      address,
      agentdUrl: `http://${containerName}:${input.backendConfig.agentdPort}`,
      metadata: {
        networkName,
        baseImage: input.backendConfig.baseImage,
        hostname,
        authToken,
      },
    };
  }

  private async inspectContainerIp(containerName: string): Promise<string> {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      "-f",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      containerName,
    ]);

    return stdout.trim() || containerName;
  }

  private async inspectContainerInstance(
    instance: ProvisionedTeamInstance,
    tailLines: number,
  ): Promise<RuntimeInstanceInspection> {
    const inspection = await execFileAsync("docker", [
      "inspect",
      instance.instanceId,
    ]).then(({ stdout }) => JSON.parse(stdout) as Array<Record<string, unknown>>).catch(() => null);

    if (!inspection || inspection.length === 0) {
      return {
        teamId: instance.teamId,
        instanceId: instance.instanceId,
        address: instance.address,
        agentdUrl: instance.agentdUrl,
        backend: this.kind,
        state: "missing",
        statusText: "container not found",
        image: null,
        createdAt: null,
        logs: [],
        metadata: instance.metadata,
        services: [],
        errors: ["container not found"],
      };
    }

    const container = inspection[0] ?? {};
    const state = (container.State ?? {}) as Record<string, unknown>;
    const image = (container.Config ?? {}) as Record<string, unknown>;
    const logs = await execFileAsync("docker", [
      "logs",
      "--tail",
      String(tailLines),
      instance.instanceId,
    ]).then(({ stdout, stderr }) => `${stdout}${stderr}`.split("\n").filter((line) => line.trim())).catch((error: Error) => [
      `failed to fetch logs: ${error.message}`,
    ]);

    return {
      teamId: instance.teamId,
      instanceId: instance.instanceId,
      address: instance.address,
      agentdUrl: instance.agentdUrl,
      backend: this.kind,
      state: this.normalizeContainerState(state),
      statusText: String(state.Status ?? "unknown"),
      image: typeof image.Image === "string" ? image.Image : null,
      createdAt: typeof container.Created === "string" ? container.Created : null,
      logs,
      metadata: instance.metadata,
      services: [],
      errors: [],
    };
  }

  private normalizeContainerState(state: Record<string, unknown>): RuntimeInstanceInspection["state"] {
    if (state.Running === true) {
      return "running";
    }

    if (typeof state.Status === "string") {
      if (state.Status === "exited" || state.Status === "dead") {
        return "exited";
      }
      if (state.Status === "created" || state.Status === "restarting" || state.Status === "paused") {
        return "unknown";
      }
    }

    return "unknown";
  }

  private async prepareHostWorkspace(
    hostTeamRoot: string,
    roundId: string,
    teamId: string,
    services: ProvisionRoundRequest["teams"][number]["services"],
  ): Promise<void> {
    await mkdir(resolve(hostTeamRoot, "services"), { recursive: true });
    await writeFile(
      resolve(hostTeamRoot, "model-combat-round.json"),
      `${JSON.stringify({ roundId, teamId, services }, null, 2)}\n`,
      "utf8",
    );

    for (const service of services) {
      const serviceRoot = resolve(hostTeamRoot, "services", service.serviceId);
      await mkdir(serviceRoot, { recursive: true });
      await writeFile(
        resolve(serviceRoot, "SERVICE.json"),
        `${JSON.stringify(service, null, 2)}\n`,
        "utf8",
      );
    }
  }

  private async ensureBaseImage(baseImage: string): Promise<void> {
    if (baseImage !== localArenaAgentdImage) {
      return;
    }

    const forceRebuild = process.env.ARENA_AGENTD_FORCE_REBUILD === "true";
    const { stdout } = await execFileAsync("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}"]);
    const images = stdout.split("\n").map((line) => line.trim());
    if (!forceRebuild && images.includes(localArenaAgentdImage)) {
      return;
    }

    await execFileAsync("docker", [
      "build",
      "-f",
      "docker/arena-agentd/Dockerfile",
      "-t",
      localArenaAgentdImage,
      ".",
    ], {
      cwd: repoRoot,
    });
  }
}
