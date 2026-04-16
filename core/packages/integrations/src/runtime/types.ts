import type { ExecutionBackend, RuntimeBackendConfig, RuntimeServiceSpec } from "@model-combat/contracts";

export interface RuntimeTeamSpec {
  teamId: string;
  hostname: string;
  workspacePath: string;
  services: RuntimeServiceSpec[];
}

export interface ProvisionRoundRequest {
  roundId: string;
  judgeUrl: string;
  backendConfig: RuntimeBackendConfig;
  teams: RuntimeTeamSpec[];
}

export interface ProvisionedTeamInstance {
  teamId: string;
  instanceId: string;
  address: string;
  agentdUrl: string;
  metadata: Record<string, unknown>;
}

export interface ProvisionRoundResult {
  backend: ExecutionBackend;
  networkId: string;
  teams: ProvisionedTeamInstance[];
}

export interface InspectRoundRequest {
  roundId: string;
  backendConfig: RuntimeBackendConfig;
  instances: ProvisionedTeamInstance[];
  tailLines?: number;
}

export interface RuntimeServiceInspection {
  serviceId: string;
  displayName?: string;
  port?: number | null;
  running?: boolean | null;
  pid?: number | null;
  restartCount?: number | null;
  lastExitCode?: number | null;
  logs?: string[];
  error?: string | null;
}

export interface RuntimeInstanceInspection {
  teamId: string;
  instanceId: string;
  address: string;
  agentdUrl: string;
  backend: ExecutionBackend;
  state: "running" | "exited" | "missing" | "unknown";
  statusText: string;
  image?: string | null;
  createdAt?: string | null;
  logs: string[];
  metadata: Record<string, unknown>;
  services: RuntimeServiceInspection[];
  errors: string[];
}

export interface RuntimeRoundInspection {
  roundId: string;
  backend: ExecutionBackend;
  networkId: string | null;
  collectedAt: string;
  instances: RuntimeInstanceInspection[];
  errors: string[];
}

export interface CompetitionRuntimeBackend {
  readonly kind: ExecutionBackend;
  provisionRound(input: ProvisionRoundRequest): Promise<ProvisionRoundResult>;
  destroyRound(roundId: string, backendConfig: RuntimeBackendConfig): Promise<void>;
  inspectRound(input: InspectRoundRequest): Promise<RuntimeRoundInspection>;
}
