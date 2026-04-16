import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import {
  createRoundRequestSchema,
  flagSubmissionRequestSchema,
  reportSummarySchema,
  traceEventSchema,
} from "@model-combat/contracts";
import { JudgeControlPlane } from "./control-plane.js";

const port = Number(process.env.PORT ?? "4010");
const controlPlane = new JudgeControlPlane(port);
await controlPlane.init();
const adminDashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../admin-dashboard/dist");

const app = Fastify({
  logger: true,
});

await app.register(swagger, {
  openapi: {
    info: {
      title: "Model Combat Judge API",
      version: "0.2.0",
    },
  },
});

await app.register(swaggerUi, {
  routePrefix: "/docs",
});

if (existsSync(adminDashboardRoot)) {
  await app.register(fastifyStatic, {
    root: adminDashboardRoot,
    prefix: "/admin/",
    index: ["index.html"],
  });

  app.get("/admin", async (_request, reply) => {
    return reply.redirect("/admin/");
  });
} else {
  app.get("/admin", async (_request, reply) => {
    return reply
      .code(503)
      .type("text/plain")
      .send("Admin dashboard build not found. Run `pnpm --filter @model-combat/admin-dashboard build`.");
  });
}

app.get("/healthz", async () => ({
  ok: true,
  currentRoundId: controlPlane.getCurrentRound()?.roundId ?? null,
  currentWave: controlPlane.getCurrentWave(),
}));

app.get("/api/v1/rounds/current", async () => ({
  round: controlPlane.getCurrentRound(),
  wave: controlPlane.getCurrentWave(),
}));

app.get("/api/v1/waves/current", async () => ({
  wave: controlPlane.getCurrentWave(),
}));

app.get("/api/v1/leaderboard", async (request) => {
  const query = request.query as { roundId?: string };
  return {
    entries: controlPlane.getLeaderboard(query.roundId),
  };
});

app.get("/api/v1/leaderboard/stream", async (request, reply) => {
  const query = request.query as { roundId?: string };
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  });

  const sendSnapshot = () => {
    reply.raw.write(`event: leaderboard\n`);
    reply.raw.write(`data: ${JSON.stringify({ entries: controlPlane.getLeaderboard(query.roundId) })}\n\n`);
  };

  sendSnapshot();
  const interval = setInterval(sendSnapshot, 1000);
  request.raw.on("close", () => clearInterval(interval));
  return reply;
});

app.get("/api/v1/rounds/:roundId/report", async (request, reply) => {
  const roundId = (request.params as { roundId: string }).roundId;

  try {
    return reportSummarySchema.parse(controlPlane.getRoundReport(roundId));
  } catch {
    return reply.code(404).send({ error: "round not found" });
  }
});

app.get("/api/v1/rounds/:roundId/findings", async (request, reply) => {
  const roundId = (request.params as { roundId: string }).roundId;
  try {
    return {
      findings: controlPlane.getRoundFindings(roundId),
    };
  } catch {
    return reply.code(404).send({ error: "round not found" });
  }
});

app.get("/api/v1/rounds/:roundId/score-events", async (request, reply) => {
  const roundId = (request.params as { roundId: string }).roundId;
  try {
    return {
      events: controlPlane.getRoundScoreEvents(roundId),
    };
  } catch {
    return reply.code(404).send({ error: "round not found" });
  }
});

app.get("/api/v1/team/bootstrap", async (request, reply) => {
  const query = request.query as { teamId?: string };
  try {
    return controlPlane.buildTeamBootstrap(query.teamId ?? "team-1");
  } catch (error) {
    return reply.code(404).send({ error: error instanceof Error ? error.message : "bootstrap unavailable" });
  }
});

app.get("/api/v1/team/targets", async (request) => {
  const query = request.query as { roundId?: string };
  return {
    teams: controlPlane.getTargets(query.roundId),
  };
});

app.get("/api/v1/team/services", async (request, reply) => {
  const query = request.query as { teamId?: string };
  try {
    return {
      services: controlPlane.buildTeamBootstrap(query.teamId ?? "team-1").services,
    };
  } catch (error) {
    return reply.code(404).send({ error: error instanceof Error ? error.message : "services unavailable" });
  }
});

app.get("/api/v1/team/traces/stream", async (request, reply) => {
  const query = request.query as { teamId?: string; roundId?: string };
  const teamId = query.teamId ?? "team-1";

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  });

  const sendSnapshot = () => {
    for (const trace of controlPlane.getTeamTraces(teamId, query.roundId)) {
      reply.raw.write(`event: trace\n`);
      reply.raw.write(`data: ${JSON.stringify(trace)}\n\n`);
    }
  };

  sendSnapshot();
  const interval = setInterval(sendSnapshot, 1000);
  request.raw.on("close", () => clearInterval(interval));
  return reply;
});

app.get("/api/v1/teams/:teamId/traces", async (request) => {
  const params = request.params as { teamId: string };
  const query = request.query as { roundId?: string };
  return {
    traces: controlPlane.getTeamTraces(params.teamId, query.roundId),
  };
});

app.post("/api/v1/flags/submit", async (request, reply) => {
  const body = flagSubmissionRequestSchema.parse(request.body);
  const outcome = await controlPlane.submitFlag(body.teamId, body.flag);

  if (!outcome.accepted) {
    return reply.code(400).send(outcome);
  }

  return outcome;
});

app.post("/api/v1/admin/rounds", async (request) => {
  const body = createRoundRequestSchema.parse(request.body);
  const round = await controlPlane.createRound(body);

  return {
    status: "created",
    round,
  };
});

app.get("/api/v1/admin/dashboard", async (request) => {
  const query = request.query as { roundId?: string };
  return controlPlane.getAdminSnapshot(query.roundId);
});

app.post("/api/v1/admin/rounds/:id/provision", async (request) => {
  const roundId = (request.params as { id: string }).id;
  return controlPlane.provisionRound(roundId);
});

app.post("/api/v1/admin/rounds/:id/start", async (request) => {
  const roundId = (request.params as { id: string }).id;
  return controlPlane.startRound(roundId);
});

app.post("/api/v1/admin/rounds/:id/pause", async (request) => {
  const roundId = (request.params as { id: string }).id;
  return controlPlane.pauseRound(roundId);
});

app.post("/api/v1/admin/rounds/:id/abort", async (request) => {
  const roundId = (request.params as { id: string }).id;
  return controlPlane.abortRound(roundId);
});

app.post("/api/v1/admin/rounds/:id/finalize", async (request) => {
  const roundId = (request.params as { id: string }).id;
  return controlPlane.finalizeRound(roundId);
});

app.post("/api/v1/admin/rounds/:id/advance-wave", async (request) => {
  const roundId = (request.params as { id: string }).id;
  return controlPlane.advanceWave(roundId);
});

app.post("/api/v1/admin/teams/:id/quarantine", async (request) => ({
  status: "quarantined",
  teamId: (request.params as { id: string }).id,
}));

app.post("/api/v1/admin/submissions/:id/replay", async (request) => ({
  status: "queued",
  submissionId: (request.params as { id: string }).id,
}));

app.get("/internal/team-runtime", async (request, reply) => {
  const query = request.query as { teamId?: string; roundId?: string };

  try {
    return controlPlane.getInternalTeamRuntime(query.teamId ?? "team-1", query.roundId);
  } catch (error) {
    return reply.code(404).send({ error: error instanceof Error ? error.message : "runtime unavailable" });
  }
});

app.post("/internal/traces/batch", async (request) => {
  const body = request.body as { traces: unknown[] };
  const traces = body.traces.map((trace) => traceEventSchema.parse(trace));
  return {
    accepted: await controlPlane.addTraces(traces),
  };
});

app.post("/internal/checker-results", async (request) => {
  const body = request.body as Record<string, unknown>;
  await controlPlane.addCheckerResult({
    jobId: String(body.jobId ?? randomId()),
    success: Boolean(body.success),
    exitCode: Number(body.exitCode ?? 0),
    startedAt: String(body.startedAt ?? new Date().toISOString()),
    finishedAt: String(body.finishedAt ?? new Date().toISOString()),
    stdout: String(body.stdout ?? ""),
    stderr: String(body.stderr ?? ""),
    roundId: typeof body.roundId === "string" ? body.roundId : undefined,
    teamId: typeof body.teamId === "string" ? body.teamId : undefined,
    serviceId: typeof body.serviceId === "string" ? body.serviceId : undefined,
  });
  return { accepted: true };
});

app.post("/internal/provisioning-events", async () => ({
  accepted: true,
}));

app.post("/internal/agent-heartbeats", async (request) => {
  const body = request.body as { teamId?: string; [key: string]: unknown };
  if (body.teamId) {
    await controlPlane.addHeartbeat(body.teamId, body);
  }
  return { accepted: true };
});

await app.listen({
  host: "0.0.0.0",
  port,
});

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
