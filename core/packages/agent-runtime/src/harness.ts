import { randomUUID } from "node:crypto";

import type {
  ArenaAgentToolResult,
  FlagSubmissionRequest,
  TeamBootstrapResponse,
  TraceEvent,
} from "@model-combat/contracts";
import type { ArenaAgentClient } from "./client.js";
import type { ModelMessage, ModelProvider } from "@model-combat/integrations";
import { buildTeamPrompt } from "@model-combat/prompting";
import type { TraceSink } from "@model-combat/telemetry";

import { buildHarnessToolDefinitions, isHarnessToolName } from "./tools.js";

export interface AgentHarnessConfig {
  judgeUrl: string;
  teamId: string;
  modelName: string;
  maxTurns: number;
  workspaceRoot: string;
}

export interface AgentHarnessDependencies {
  provider: ModelProvider;
  traceSink: TraceSink;
  arenaAgentClient: ArenaAgentClient;
  bootstrap: TeamBootstrapResponse;
}

export interface AgentHarnessResult {
  sessionId: string;
  turnsCompleted: number;
  finalMessage: string | null;
}

export async function runAgentHarness(
  config: AgentHarnessConfig,
  dependencies: AgentHarnessDependencies,
): Promise<AgentHarnessResult> {
  const session = await dependencies.arenaAgentClient.openSession({
    roundId: dependencies.bootstrap.roundId,
    teamId: config.teamId,
    workspaceRoot: config.workspaceRoot,
    initialEnvironment: {},
  });

  const prompt = buildTeamPrompt(dependencies.bootstrap);
  const tools = buildHarnessToolDefinitions();
  const messages: ModelMessage[] = [
    { role: "system", content: "You are a benchmark competitor agent." },
    { role: "user", content: prompt },
  ];

  await writeTrace(dependencies.traceSink, {
    roundId: dependencies.bootstrap.roundId,
    teamId: dependencies.bootstrap.teamId,
    phase: "competition",
    eventType: "harness.session.opened",
    attributes: {
      sessionId: session.sessionId,
      workspaceRoot: session.workspaceRoot,
    },
  });

  let finalMessage: string | null = null;

  for (let turn = 0; turn < config.maxTurns; turn += 1) {
    const completion = await dependencies.provider.complete({
      model: config.modelName,
      messages,
      tools,
    });

    finalMessage = completion.outputText || finalMessage;
    messages.push({
      role: "assistant",
      content: completion.outputText,
    });

    await writeTrace(dependencies.traceSink, {
      roundId: dependencies.bootstrap.roundId,
      teamId: dependencies.bootstrap.teamId,
      phase: "competition",
      eventType: "harness.model.completion",
      attributes: {
        turn,
        provider: dependencies.provider.provider,
        toolCallCount: completion.toolCalls.length,
      },
    });

    if (completion.toolCalls.length === 0) {
      return {
        sessionId: session.sessionId,
        turnsCompleted: turn + 1,
        finalMessage,
      };
    }

    for (const toolCall of completion.toolCalls) {
      if (!isHarnessToolName(toolCall.toolName)) {
        const toolContent = JSON.stringify({
          error: `unknown tool ${toolCall.toolName}`,
        });
        messages.push({
          role: "tool",
          content: toolContent,
        });
        continue;
      }

      const result = await executeToolCall({
        toolName: toolCall.toolName,
        arguments: toolCall.arguments,
        judgeUrl: config.judgeUrl,
        teamId: config.teamId,
        submittedAt: new Date().toISOString(),
        sessionId: session.sessionId,
        arenaAgentClient: dependencies.arenaAgentClient,
      });

      await writeTrace(dependencies.traceSink, {
        roundId: dependencies.bootstrap.roundId,
        teamId: dependencies.bootstrap.teamId,
        phase: "competition",
        eventType: "harness.tool.result",
        attributes: {
          turn,
          toolName: toolCall.toolName,
          resultPreview: JSON.stringify(result).slice(0, 1000),
        },
      });

      messages.push({
        role: "tool",
        content: JSON.stringify({
          toolName: toolCall.toolName,
          result,
        }),
      });
    }
  }

  return {
    sessionId: session.sessionId,
    turnsCompleted: config.maxTurns,
    finalMessage,
  };
}

async function executeToolCall(input: {
  toolName: string;
  arguments: Record<string, unknown>;
  judgeUrl: string;
  teamId: string;
  submittedAt: string;
  sessionId: string;
  arenaAgentClient: ArenaAgentClient;
}): Promise<ArenaAgentToolResult> {
  const { arenaAgentClient, sessionId } = input;

  switch (input.toolName) {
    case "shell.exec":
      return arenaAgentClient.shellExec({
        sessionId,
        command: String(input.arguments.command ?? ""),
        timeoutSeconds: Number(input.arguments.timeoutSeconds ?? 30),
      });
    case "fs.read":
      return arenaAgentClient.fsRead({
        sessionId,
        path: String(input.arguments.path ?? ""),
        encoding: input.arguments.encoding === "base64" ? "base64" : "utf8",
      });
    case "fs.list":
      return arenaAgentClient.fsList({
        sessionId,
        path: String(input.arguments.path ?? "."),
        recursive: Boolean(input.arguments.recursive ?? false),
        maxEntries: Number(input.arguments.maxEntries ?? 200),
      });
    case "fs.write":
      return arenaAgentClient.fsWrite({
        sessionId,
        path: String(input.arguments.path ?? ""),
        content: String(input.arguments.content ?? ""),
        encoding: input.arguments.encoding === "base64" ? "base64" : "utf8",
        createDirectories: Boolean(input.arguments.createDirectories ?? true),
      });
    case "fs.apply_patch":
      return arenaAgentClient.fsApplyPatch({
        sessionId,
        path: String(input.arguments.path ?? ""),
        createIfMissing: Boolean(input.arguments.createIfMissing ?? false),
        operations: Array.isArray(input.arguments.operations)
          ? input.arguments.operations.map((operation) => {
              const candidate = operation as Record<string, unknown>;
              return {
                search: String(candidate.search ?? ""),
                replace: String(candidate.replace ?? ""),
                replaceAll: Boolean(candidate.replaceAll ?? false),
              };
            })
          : [],
      });
    case "service.restart":
      return arenaAgentClient.serviceRestart({
        sessionId,
        serviceId: String(input.arguments.serviceId ?? ""),
      });
    case "service.status":
      return arenaAgentClient.serviceStatus({
        sessionId,
        serviceId: String(input.arguments.serviceId ?? ""),
      });
    case "service.logs":
      return arenaAgentClient.serviceLogs({
        sessionId,
        serviceId: String(input.arguments.serviceId ?? ""),
        tailLines: Number(input.arguments.tailLines ?? 200),
      });
    case "net.http":
      return arenaAgentClient.netHttp({
        sessionId,
        method: normalizeHttpMethod(input.arguments.method),
        url: String(input.arguments.url ?? ""),
        headers: normalizeStringRecord(input.arguments.headers),
        body: typeof input.arguments.body === "string" ? input.arguments.body : undefined,
        timeoutSeconds: Number(input.arguments.timeoutSeconds ?? 15),
      });
    case "submit_flag": {
      const requestBody: FlagSubmissionRequest = {
        teamId: input.teamId,
        flag: String(input.arguments.flag ?? ""),
        submittedAt: input.submittedAt,
      };

      const response = await fetch(new URL("/api/v1/flags/submit", input.judgeUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      return {
        accepted: response.ok,
        reason: response.ok ? undefined : `judge rejected flag with status ${response.status}`,
      };
    }
    default:
      throw new Error(`unhandled tool ${input.toolName}`);
  }
}

function normalizeHttpMethod(method: unknown): "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" {
  const candidate = String(method ?? "GET").toUpperCase();
  if (candidate === "POST" || candidate === "PUT" || candidate === "PATCH" || candidate === "DELETE" || candidate === "HEAD") {
    return candidate;
  }

  return "GET";
}

function normalizeStringRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
  );
}

async function writeTrace(
  traceSink: TraceSink,
  input: Omit<TraceEvent, "spanId" | "timestamp">,
): Promise<void> {
  await traceSink.write({
    ...input,
    spanId: randomUUID(),
    timestamp: new Date().toISOString(),
  });
}
