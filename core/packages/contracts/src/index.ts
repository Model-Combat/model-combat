import { z } from "zod";

export const repoBucketValues = [
  "knowledge",
  "stateful-utility",
  "realtime-collab",
] as const;

export const protocolValues = ["http", "https", "websocket", "tcp"] as const;
export const executionBackendValues = ["aws-ec2", "docker-local"] as const;

export const scoreEventTypeValues = [
  "SERVICE_UP",
  "SERVICE_DOWN",
  "FLAG_STOLEN_FIRST",
  "FLAG_LOST_FIRST",
  "SUBMISSION_DUPLICATE",
  "SUBMISSION_STALE",
  "TEAM_QUARANTINED",
] as const;

export const findingStatusValues = [
  "candidate",
  "verified",
  "rejected",
  "accepted",
] as const;

export const tracePhaseValues = [
  "seeding",
  "verification",
  "competition",
  "scoring",
  "publication",
] as const;

export const arenaAgentToolNameValues = [
  "shell.exec",
  "fs.read",
  "fs.list",
  "fs.write",
  "fs.apply_patch",
  "service.restart",
  "service.status",
  "service.logs",
  "net.http",
  "submit_flag",
] as const;

export const repoBucketSchema = z.enum(repoBucketValues);
export const protocolSchema = z.enum(protocolValues);
export const executionBackendSchema = z.enum(executionBackendValues);
export const scoreEventTypeSchema = z.enum(scoreEventTypeValues);
export const findingStatusSchema = z.enum(findingStatusValues);
export const tracePhaseSchema = z.enum(tracePhaseValues);
export const arenaAgentToolNameSchema = z.enum(arenaAgentToolNameValues);

export const runtimeBackendConfigSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("aws-ec2"),
    region: z.string().min(1),
    accountPool: z.array(z.string().min(1)).default([]),
    instanceProfile: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("docker-local"),
    networkNamePrefix: z.string().min(1).default("model-combat"),
    baseImage: z.string().min(1).default("model-combat/arena-agentd:local"),
    hostWorkspaceRoot: z.string().min(1).optional(),
    agentdPort: z.number().int().min(1).max(65535).default(9000),
  }),
]);

export const serviceTemplateSchema = z.object({
  serviceId: z.string().min(1),
  displayName: z.string().min(1),
  upstreamUrl: z.string().url(),
  bucket: repoBucketSchema,
  license: z.string().min(1),
  protocol: protocolSchema,
  port: z.number().int().min(1).max(65535),
  buildCmd: z.string().min(1),
  startCmd: z.string().min(1),
  checkPath: z.string().min(1),
  putFlagPath: z.string().min(1),
  getFlagPath: z.string().min(1),
  artifactPaths: z.array(z.string()),
  seedConstraints: z.array(z.string()),
  resourceLimits: z.object({
    cpuShares: z.number().int().positive(),
    memoryMb: z.number().int().positive(),
    timeoutSeconds: z.number().int().positive(),
  }),
});

export const repoPoolEntrySchema = serviceTemplateSchema.extend({
  qualificationStatus: z.enum(["candidate", "qualified", "suspended"]),
  whyIncluded: z.string().min(1),
  adapterShape: z.string().min(1),
  sourceUrls: z.array(z.string().url()).min(1),
});

export const findingSchema = z.object({
  findingId: z.string().min(1),
  roundId: z.string().min(1),
  serviceId: z.string().min(1),
  authorModel: z.string().min(1),
  verifierModel: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  leakTarget: z.string().min(1),
  exploitPath: z.string().min(1),
  exploitSuccessRate: z.number().min(0).max(1),
  patchExpectation: z.string().min(1),
  status: findingStatusSchema,
});

export const roundModelSchema = z.object({
  slot: z.number().int().nonnegative(),
  provider: z.string().min(1),
  model: z.string().min(1),
  role: z.enum(["seed", "verify", "competitor"]),
});

export const roundBundleSchema = z.object({
  roundId: z.string().min(1),
  seedModels: z.array(roundModelSchema).min(1),
  competitorRoster: z.array(roundModelSchema),
  serviceTemplates: z.array(serviceTemplateSchema).length(3),
  seededRepoRefs: z.array(z.string().min(1)).length(3),
  findingManifestRefs: z.array(z.string().min(1)),
  verifierResults: z.array(
    z.object({
      findingId: z.string().min(1),
      accepted: z.boolean(),
      replayCount: z.number().int().nonnegative(),
      notes: z.string(),
    }),
  ),
  judgeConfig: z.object({
    roundDurationMinutes: z.number().int().positive(),
    waveDurationMinutes: z.number().int().positive(),
    flagTtlWaves: z.number().int().positive(),
  }),
  runtimeBackend: runtimeBackendConfigSchema,
  runtimeImageRef: z.string().min(1),
  createdAt: z.string().datetime(),
  digest: z.string().min(1),
});

export const flagMetadataSchema = z.object({
  roundId: z.string().min(1),
  teamId: z.string().min(1),
  serviceId: z.string().min(1),
  wave: z.number().int().nonnegative(),
  nonce: z.string().min(1),
});

export const flagSchema = flagMetadataSchema.extend({
  flagId: z.string().min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  status: z.enum(["pending", "active", "stale", "stolen", "invalid"]),
  firstStolenBy: z.string().min(1).nullable(),
  validationTag: z.string().min(1),
});

export const scoreEventSchema = z.object({
  eventId: z.string().min(1),
  roundId: z.string().min(1),
  teamId: z.string().min(1),
  serviceId: z.string().min(1),
  wave: z.number().int().nonnegative(),
  type: scoreEventTypeSchema,
  delta: z.number().int(),
  relatedTeamId: z.string().min(1).nullable(),
  flagId: z.string().min(1).nullable(),
  submissionId: z.string().min(1).nullable(),
  traceSpanId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
});

export const leaderboardEntrySchema = z.object({
  teamId: z.string().min(1),
  score: z.number().int(),
  servicesUp: z.number().int().nonnegative(),
  servicesDown: z.number().int().nonnegative(),
  flagsStolen: z.number().int().nonnegative(),
  flagsLost: z.number().int().nonnegative(),
});

export const teamServiceSchema = z.object({
  serviceId: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  port: z.number().int().positive(),
  codePath: z.string().min(1),
});

export const runtimeServiceSpecSchema = z.object({
  serviceId: z.string().min(1),
  displayName: z.string().min(1),
  protocol: protocolSchema,
  port: z.number().int().positive(),
  workingDirectory: z.string().min(1),
  buildCommand: z.string().min(1).optional(),
  startCommand: z.string().min(1).optional(),
});

export const teamBootstrapResponseSchema = z.object({
  roundId: z.string().min(1),
  teamId: z.string().min(1),
  judgeUrl: z.string().url(),
  teamIp: z.string().min(1),
  runtimeBackend: executionBackendSchema,
  targetsUrl: z.string().url(),
  services: z.array(teamServiceSchema),
  waveDurationMinutes: z.number().int().positive(),
  roundDurationMinutes: z.number().int().positive(),
  rules: z.array(z.string().min(1)),
});

export const flagSubmissionRequestSchema = z.object({
  teamId: z.string().min(1),
  flag: z.string().min(1),
  submittedAt: z.string().datetime(),
});

export const createRoundRequestSchema = z.object({
  requestedBy: z.string().min(1),
  notes: z.string().default(""),
  preferredRepos: z.array(z.string().min(1)).max(3).default([]),
  preferredModels: z.array(z.string().min(1)).default([]),
  runtimeBackend: runtimeBackendConfigSchema.default({
    kind: "aws-ec2",
    region: "us-east-1",
    accountPool: [],
  }),
});

export const checkerJobSchema = z.object({
  jobId: z.string().min(1),
  kind: z.enum(["check", "put_flag", "get_flag", "exploit_replay"]),
  roundId: z.string().min(1),
  teamId: z.string().min(1),
  serviceId: z.string().min(1),
  targetUrl: z.string().url(),
  scriptPath: z.string().min(1),
  env: z.record(z.string(), z.string()),
  timeoutSeconds: z.number().int().positive(),
});

export const checkerResultSchema = z.object({
  jobId: z.string().min(1),
  success: z.boolean(),
  exitCode: z.number().int(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  stdout: z.string(),
  stderr: z.string(),
});

export const traceEventSchema = z.object({
  spanId: z.string().min(1),
  roundId: z.string().min(1),
  teamId: z.string().min(1),
  phase: tracePhaseSchema,
  eventType: z.string().min(1),
  timestamp: z.string().datetime(),
  attributes: z.record(z.string(), z.unknown()),
});

export const arenaAgentSessionSchema = z.object({
  sessionId: z.string().min(1),
  roundId: z.string().min(1),
  teamId: z.string().min(1),
  workspaceRoot: z.string().min(1),
  currentDirectory: z.string().min(1),
  openedAt: z.string().datetime(),
});

export const arenaAgentOpenSessionRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  roundId: z.string().min(1),
  teamId: z.string().min(1),
  workspaceRoot: z.string().min(1),
  initialEnvironment: z.record(z.string(), z.string()).default({}),
});

export const arenaAgentShellExecRequestSchema = z.object({
  sessionId: z.string().min(1),
  command: z.string().min(1),
  timeoutSeconds: z.number().int().positive().max(300).default(30),
});

export const arenaAgentShellExecResponseSchema = z.object({
  commandId: z.string().min(1),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  currentDirectory: z.string().min(1),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  timedOut: z.boolean().default(false),
});

export const arenaAgentFsReadRequestSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});

export const arenaAgentFsReadResponseSchema = z.object({
  path: z.string().min(1),
  encoding: z.enum(["utf8", "base64"]),
  content: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

export const arenaAgentFsListEntrySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["file", "directory", "symlink", "other"]),
  sizeBytes: z.number().int().nonnegative().nullable(),
});

export const arenaAgentFsListRequestSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  recursive: z.boolean().default(false),
  maxEntries: z.number().int().positive().max(5000).default(200),
});

export const arenaAgentFsListResponseSchema = z.object({
  path: z.string().min(1),
  entries: z.array(arenaAgentFsListEntrySchema),
});

export const arenaAgentFsWriteRequestSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  createDirectories: z.boolean().default(true),
});

export const arenaAgentFsWriteResponseSchema = z.object({
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});

export const arenaAgentFsPatchOperationSchema = z.object({
  search: z.string(),
  replace: z.string(),
  replaceAll: z.boolean().default(false),
});

export const arenaAgentFsApplyPatchRequestSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  operations: z.array(arenaAgentFsPatchOperationSchema).min(1),
  createIfMissing: z.boolean().default(false),
});

export const arenaAgentFsApplyPatchResponseSchema = z.object({
  path: z.string().min(1),
  operationsApplied: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
});

export const arenaAgentServiceStatusSchema = z.object({
  serviceId: z.string().min(1),
  running: z.boolean(),
  pid: z.number().int().positive().nullable(),
  restartCount: z.number().int().nonnegative(),
  lastExitCode: z.number().int().nullable(),
  port: z.number().int().positive().nullable(),
  workingDirectory: z.string().min(1).nullable(),
});

export const arenaAgentServiceControlRequestSchema = z.object({
  sessionId: z.string().min(1),
  serviceId: z.string().min(1),
});

export const arenaAgentServiceLogsRequestSchema = z.object({
  sessionId: z.string().min(1),
  serviceId: z.string().min(1),
  tailLines: z.number().int().positive().max(1000).default(200),
});

export const arenaAgentServiceLogsResponseSchema = z.object({
  serviceId: z.string().min(1),
  lines: z.array(z.string()),
});

export const arenaAgentHttpRequestSchema = z.object({
  sessionId: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).default("GET"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().optional(),
  timeoutSeconds: z.number().int().positive().max(120).default(15),
});

export const arenaAgentHttpResponseSchema = z.object({
  statusCode: z.number().int(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
});

export const arenaAgentToolResultSchema = z.union([
  arenaAgentShellExecResponseSchema,
  arenaAgentFsReadResponseSchema,
  arenaAgentFsListResponseSchema,
  arenaAgentFsWriteResponseSchema,
  arenaAgentFsApplyPatchResponseSchema,
  arenaAgentServiceStatusSchema,
  arenaAgentServiceLogsResponseSchema,
  arenaAgentHttpResponseSchema,
  z.object({
    accepted: z.boolean(),
    reason: z.string().optional(),
  }),
]);

export const reportSummarySchema = z.object({
  roundId: z.string().min(1),
  winningTeamId: z.string().min(1),
  totalFindings: z.number().int().nonnegative(),
  totalSubmissions: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
});

export type RepoBucket = z.infer<typeof repoBucketSchema>;
export type Protocol = z.infer<typeof protocolSchema>;
export type ExecutionBackend = z.infer<typeof executionBackendSchema>;
export type ScoreEventType = z.infer<typeof scoreEventTypeSchema>;
export type FindingStatus = z.infer<typeof findingStatusSchema>;
export type TracePhase = z.infer<typeof tracePhaseSchema>;
export type ArenaAgentToolName = z.infer<typeof arenaAgentToolNameSchema>;
export type ServiceTemplate = z.infer<typeof serviceTemplateSchema>;
export type RuntimeServiceSpec = z.infer<typeof runtimeServiceSpecSchema>;
export type RuntimeBackendConfig = z.infer<typeof runtimeBackendConfigSchema>;
export type RepoPoolEntry = z.infer<typeof repoPoolEntrySchema>;
export type Finding = z.infer<typeof findingSchema>;
export type RoundModel = z.infer<typeof roundModelSchema>;
export type RoundBundle = z.infer<typeof roundBundleSchema>;
export type FlagMetadata = z.infer<typeof flagMetadataSchema>;
export type FlagRecord = z.infer<typeof flagSchema>;
export type ScoreEvent = z.infer<typeof scoreEventSchema>;
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;
export type TeamService = z.infer<typeof teamServiceSchema>;
export type TeamBootstrapResponse = z.infer<typeof teamBootstrapResponseSchema>;
export type FlagSubmissionRequest = z.infer<typeof flagSubmissionRequestSchema>;
export type CreateRoundRequest = z.infer<typeof createRoundRequestSchema>;
export type CheckerJob = z.infer<typeof checkerJobSchema>;
export type CheckerResult = z.infer<typeof checkerResultSchema>;
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type ReportSummary = z.infer<typeof reportSummarySchema>;
export type ArenaAgentSession = z.infer<typeof arenaAgentSessionSchema>;
export type ArenaAgentOpenSessionRequest = z.infer<typeof arenaAgentOpenSessionRequestSchema>;
export type ArenaAgentShellExecRequest = z.infer<typeof arenaAgentShellExecRequestSchema>;
export type ArenaAgentShellExecResponse = z.infer<typeof arenaAgentShellExecResponseSchema>;
export type ArenaAgentFsReadRequest = z.infer<typeof arenaAgentFsReadRequestSchema>;
export type ArenaAgentFsReadResponse = z.infer<typeof arenaAgentFsReadResponseSchema>;
export type ArenaAgentFsListEntry = z.infer<typeof arenaAgentFsListEntrySchema>;
export type ArenaAgentFsListRequest = z.infer<typeof arenaAgentFsListRequestSchema>;
export type ArenaAgentFsListResponse = z.infer<typeof arenaAgentFsListResponseSchema>;
export type ArenaAgentFsWriteRequest = z.infer<typeof arenaAgentFsWriteRequestSchema>;
export type ArenaAgentFsWriteResponse = z.infer<typeof arenaAgentFsWriteResponseSchema>;
export type ArenaAgentFsPatchOperation = z.infer<typeof arenaAgentFsPatchOperationSchema>;
export type ArenaAgentFsApplyPatchRequest = z.infer<typeof arenaAgentFsApplyPatchRequestSchema>;
export type ArenaAgentFsApplyPatchResponse = z.infer<typeof arenaAgentFsApplyPatchResponseSchema>;
export type ArenaAgentServiceStatus = z.infer<typeof arenaAgentServiceStatusSchema>;
export type ArenaAgentServiceControlRequest = z.infer<typeof arenaAgentServiceControlRequestSchema>;
export type ArenaAgentServiceLogsRequest = z.infer<typeof arenaAgentServiceLogsRequestSchema>;
export type ArenaAgentServiceLogsResponse = z.infer<typeof arenaAgentServiceLogsResponseSchema>;
export type ArenaAgentHttpRequest = z.infer<typeof arenaAgentHttpRequestSchema>;
export type ArenaAgentHttpResponse = z.infer<typeof arenaAgentHttpResponseSchema>;
export type ArenaAgentToolResult = z.infer<typeof arenaAgentToolResultSchema>;
