import Fastify from "fastify";

import {
  arenaAgentFsApplyPatchRequestSchema,
  arenaAgentFsListRequestSchema,
  arenaAgentFsReadRequestSchema,
  arenaAgentFsWriteRequestSchema,
  arenaAgentHttpRequestSchema,
  arenaAgentOpenSessionRequestSchema,
  arenaAgentServiceControlRequestSchema,
  arenaAgentServiceLogsRequestSchema,
  arenaAgentShellExecRequestSchema,
  runtimeServiceSpecSchema,
  type RuntimeServiceSpec,
} from "@model-combat/contracts";

import { SessionManager } from "./session-manager.js";
import { ServiceManager } from "./service-manager.js";

const app = Fastify({
  logger: true,
});

const authToken = process.env.ARENA_AGENTD_AUTH_TOKEN;
const defaultWorkspaceRoot = process.env.ARENA_AGENTD_WORKSPACE_ROOT ?? "/srv/model-combat";
const configuredServices = parseConfiguredServices(process.env.ARENA_AGENTD_SERVICES_JSON);
const sessionManager = new SessionManager();
const serviceManager = new ServiceManager(configuredServices);

if (process.env.ARENA_AGENTD_AUTO_START !== "false") {
  await serviceManager.startAll();
}

app.addHook("onRequest", async (request, reply) => {
  if (!authToken) {
    return;
  }

  const header = request.headers.authorization;
  if (header !== `Bearer ${authToken}`) {
    return reply.code(401).send({
      error: "unauthorized",
    });
  }
});

app.get("/healthz", async () => ({
  ok: true,
  serviceCount: configuredServices.length,
}));

app.post("/session/open", async (request) => {
  const body = arenaAgentOpenSessionRequestSchema.parse(request.body);
  return sessionManager.openSession({
    ...body,
    workspaceRoot: body.workspaceRoot || defaultWorkspaceRoot,
  });
});

app.post("/tools/shell.exec", async (request) => {
  const body = arenaAgentShellExecRequestSchema.parse(request.body);
  const session = sessionManager.getSession(body.sessionId);
  return session.shell.run(body.command, body.timeoutSeconds);
});

app.post("/tools/fs.read", async (request) => {
  const body = arenaAgentFsReadRequestSchema.parse(request.body);
  return sessionManager.fsRead(body.sessionId, body.path, body.encoding);
});

app.post("/tools/fs.list", async (request) => {
  const body = arenaAgentFsListRequestSchema.parse(request.body);
  return sessionManager.fsList(body.sessionId, body.path, body.recursive, body.maxEntries);
});

app.post("/tools/fs.write", async (request) => {
  const body = arenaAgentFsWriteRequestSchema.parse(request.body);
  return sessionManager.fsWrite(body);
});

app.post("/tools/fs.apply_patch", async (request) => {
  const body = arenaAgentFsApplyPatchRequestSchema.parse(request.body);
  return sessionManager.fsApplyPatch(body);
});

app.post("/tools/service.restart", async (request) => {
  const body = arenaAgentServiceControlRequestSchema.parse(request.body);
  sessionManager.getSession(body.sessionId);
  return serviceManager.restart(body.serviceId);
});

app.post("/tools/service.status", async (request) => {
  const body = arenaAgentServiceControlRequestSchema.parse(request.body);
  sessionManager.getSession(body.sessionId);
  return serviceManager.getStatus(body.serviceId);
});

app.post("/tools/service.logs", async (request) => {
  const body = arenaAgentServiceLogsRequestSchema.parse(request.body);
  sessionManager.getSession(body.sessionId);
  return {
    serviceId: body.serviceId,
    lines: serviceManager.getLogs(body.serviceId, body.tailLines),
  };
});

app.post("/tools/net.http", async (request) => {
  const body = arenaAgentHttpRequestSchema.parse(request.body);
  sessionManager.getSession(body.sessionId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), body.timeoutSeconds * 1000);

  try {
    const response = await fetch(body.url, {
      method: body.method,
      headers: body.headers,
      body: body.body,
      signal: controller.signal,
    });

    const headers = Object.fromEntries(response.headers.entries());
    const responseBody = await response.text();
    return {
      statusCode: response.status,
      headers,
      body: responseBody,
    };
  } finally {
    clearTimeout(timeout);
  }
});

const port = Number(process.env.PORT ?? "9000");
await app.listen({
  host: "0.0.0.0",
  port,
});

function parseConfiguredServices(raw: string | undefined): RuntimeServiceSpec[] {
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as unknown[];
  return parsed.map((candidate) => runtimeServiceSpecSchema.parse(candidate));
}
