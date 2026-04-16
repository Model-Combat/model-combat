import {
  arenaAgentFsApplyPatchRequestSchema,
  arenaAgentFsApplyPatchResponseSchema,
  arenaAgentFsListRequestSchema,
  arenaAgentFsListResponseSchema,
  arenaAgentFsReadRequestSchema,
  arenaAgentFsReadResponseSchema,
  arenaAgentFsWriteRequestSchema,
  arenaAgentFsWriteResponseSchema,
  arenaAgentHttpRequestSchema,
  arenaAgentHttpResponseSchema,
  arenaAgentOpenSessionRequestSchema,
  arenaAgentServiceControlRequestSchema,
  arenaAgentServiceLogsRequestSchema,
  arenaAgentServiceLogsResponseSchema,
  arenaAgentServiceStatusSchema,
  arenaAgentSessionSchema,
  arenaAgentShellExecRequestSchema,
  arenaAgentShellExecResponseSchema,
  type ArenaAgentFsApplyPatchRequest,
  type ArenaAgentFsApplyPatchResponse,
  type ArenaAgentFsListRequest,
  type ArenaAgentFsListResponse,
  type ArenaAgentFsReadRequest,
  type ArenaAgentFsReadResponse,
  type ArenaAgentFsWriteRequest,
  type ArenaAgentFsWriteResponse,
  type ArenaAgentHttpRequest,
  type ArenaAgentHttpResponse,
  type ArenaAgentOpenSessionRequest,
  type ArenaAgentServiceControlRequest,
  type ArenaAgentServiceLogsRequest,
  type ArenaAgentServiceLogsResponse,
  type ArenaAgentServiceStatus,
  type ArenaAgentSession,
  type ArenaAgentShellExecRequest,
  type ArenaAgentShellExecResponse,
} from "@model-combat/contracts";

export interface ArenaAgentClientOptions {
  baseUrl: string;
  authToken?: string;
}

export class ArenaAgentClient {
  constructor(private readonly options: ArenaAgentClientOptions) {}

  async openSession(input: ArenaAgentOpenSessionRequest): Promise<ArenaAgentSession> {
    return this.request("/session/open", arenaAgentOpenSessionRequestSchema.parse(input), arenaAgentSessionSchema);
  }

  async shellExec(input: ArenaAgentShellExecRequest): Promise<ArenaAgentShellExecResponse> {
    return this.request("/tools/shell.exec", arenaAgentShellExecRequestSchema.parse(input), arenaAgentShellExecResponseSchema);
  }

  async fsRead(input: ArenaAgentFsReadRequest): Promise<ArenaAgentFsReadResponse> {
    return this.request("/tools/fs.read", arenaAgentFsReadRequestSchema.parse(input), arenaAgentFsReadResponseSchema);
  }

  async fsList(input: ArenaAgentFsListRequest): Promise<ArenaAgentFsListResponse> {
    return this.request("/tools/fs.list", arenaAgentFsListRequestSchema.parse(input), arenaAgentFsListResponseSchema);
  }

  async fsWrite(input: ArenaAgentFsWriteRequest): Promise<ArenaAgentFsWriteResponse> {
    return this.request("/tools/fs.write", arenaAgentFsWriteRequestSchema.parse(input), arenaAgentFsWriteResponseSchema);
  }

  async fsApplyPatch(input: ArenaAgentFsApplyPatchRequest): Promise<ArenaAgentFsApplyPatchResponse> {
    return this.request(
      "/tools/fs.apply_patch",
      arenaAgentFsApplyPatchRequestSchema.parse(input),
      arenaAgentFsApplyPatchResponseSchema,
    );
  }

  async serviceRestart(input: ArenaAgentServiceControlRequest): Promise<ArenaAgentServiceStatus> {
    return this.request(
      "/tools/service.restart",
      arenaAgentServiceControlRequestSchema.parse(input),
      arenaAgentServiceStatusSchema,
    );
  }

  async serviceStatus(input: ArenaAgentServiceControlRequest): Promise<ArenaAgentServiceStatus> {
    return this.request(
      "/tools/service.status",
      arenaAgentServiceControlRequestSchema.parse(input),
      arenaAgentServiceStatusSchema,
    );
  }

  async serviceLogs(input: ArenaAgentServiceLogsRequest): Promise<ArenaAgentServiceLogsResponse> {
    return this.request(
      "/tools/service.logs",
      arenaAgentServiceLogsRequestSchema.parse(input),
      arenaAgentServiceLogsResponseSchema,
    );
  }

  async netHttp(input: ArenaAgentHttpRequest): Promise<ArenaAgentHttpResponse> {
    return this.request("/tools/net.http", arenaAgentHttpRequestSchema.parse(input), arenaAgentHttpResponseSchema);
  }

  private async request<TInput, TOutput>(
    path: string,
    input: TInput,
    outputSchema: { parse(value: unknown): TOutput },
  ): Promise<TOutput> {
    const response = await fetch(new URL(path, this.options.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.options.authToken ? { authorization: `Bearer ${this.options.authToken}` } : {}),
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`arena-agentd request ${path} failed with ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    return outputSchema.parse(payload);
  }
}
