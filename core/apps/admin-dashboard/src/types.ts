export type ExecutionBackend = "aws-ec2" | "docker-local";
export type RoundStatus = "draft" | "provisioned" | "running" | "paused" | "aborted" | "finalized";
export type WaveStatus = "running" | "completed" | "aborted";
export type ScoreEventType =
  | "SERVICE_UP"
  | "SERVICE_DOWN"
  | "FLAG_STOLEN_FIRST"
  | "FLAG_LOST_FIRST"
  | "SUBMISSION_DUPLICATE"
  | "SUBMISSION_STALE"
  | "TEAM_QUARANTINED";

export interface RoundModel {
  slot: number;
  provider: string;
  model: string;
  role: "seed" | "verify" | "competitor";
}

export interface ServiceTemplate {
  serviceId: string;
  displayName: string;
  upstreamUrl: string;
  bucket: string;
  license: string;
  protocol: string;
  port: number;
  buildCmd: string;
  startCmd: string;
  checkPath: string;
  putFlagPath: string;
  getFlagPath: string;
}

export interface RoundBundle {
  roundId: string;
  seedModels: RoundModel[];
  competitorRoster: RoundModel[];
  serviceTemplates: ServiceTemplate[];
  judgeConfig: {
    roundDurationMinutes: number;
    waveDurationMinutes: number;
    flagTtlWaves: number;
  };
  runtimeBackend:
    | {
      kind: "docker-local";
      networkNamePrefix: string;
      baseImage: string;
      hostWorkspaceRoot?: string;
      agentdPort: number;
    }
    | {
      kind: "aws-ec2";
      region: string;
      accountPool: string[];
      instanceProfile?: string;
    };
  runtimeImageRef: string;
  createdAt: string;
  digest: string;
}

export interface LeaderboardEntry {
  teamId: string;
  score: number;
  servicesUp: number;
  servicesDown: number;
  flagsStolen: number;
  flagsLost: number;
}

export interface TeamTarget {
  teamId: string;
  ip: string;
}

export interface Finding {
  findingId: string;
  serviceId: string;
  title: string;
  category: string;
  leakTarget: string;
  exploitSuccessRate: number;
  patchExpectation: string;
  status: string;
}

export interface ReportSummary {
  roundId: string;
  winningTeamId: string;
  totalFindings: number;
  totalSubmissions: number;
  generatedAt: string;
}

export interface WaveRecord {
  waveNumber: number;
  startedAt: string;
  endedAt: string | null;
  status: WaveStatus;
}

export interface TeamInstanceRecord {
  teamId: string;
  instanceId: string;
  address: string;
  agentdUrl: string;
  status: string;
  metadata: Record<string, unknown>;
}

export interface PersistedFlagRecord {
  flagId: string;
  roundId: string;
  teamId: string;
  serviceId: string;
  wave: number;
  issuedAt: string;
  expiresAt: string;
  status: string;
  firstStolenBy: string | null;
  validationTag: string;
  token: string;
}

export interface SubmissionRecord {
  submissionId: string;
  roundId: string;
  teamId: string;
  flagId: string | null;
  submittedFlag: string;
  status: string;
  createdAt: string;
}

export interface ScoreEvent {
  eventId: string;
  roundId: string;
  teamId: string;
  serviceId: string;
  wave: number;
  type: ScoreEventType;
  delta: number;
  relatedTeamId: string | null;
  flagId: string | null;
  submissionId: string | null;
  traceSpanId: string | null;
  createdAt: string;
}

export interface TraceEvent {
  spanId: string;
  roundId: string;
  teamId: string;
  timestamp: string;
  eventType: string;
  attributes: Record<string, unknown>;
}

export interface HeartbeatRecord {
  roundId: string;
  teamId: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}

export interface CheckerResult {
  jobId: string;
  success: boolean;
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  stdout: string;
  stderr: string;
  roundId?: string;
  teamId?: string;
  serviceId?: string;
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

export interface AdminActivityItem {
  id: string;
  kind: "score_event" | "submission" | "trace" | "heartbeat" | "checker_result" | "wave";
  timestamp: string;
  teamId?: string;
  serviceId?: string;
  message: string;
  details: unknown;
}

export interface AdminRoundSummary {
  roundId: string;
  status: RoundStatus;
  backend: ExecutionBackend;
  currentWave: number;
  totalWaves: number;
  startedAt: string | null;
  endedAt: string | null;
  teamCount: number;
  serviceIds: string[];
}

export interface CurrentWaveSummary {
  roundId: string;
  waveNumber: number;
  status: RoundStatus;
  activeWave: WaveRecord | null;
  totalWaves: number;
}

export interface AdminDashboardSnapshot {
  generatedAt: string;
  currentRoundId: string | null;
  currentWave: CurrentWaveSummary | null;
  rounds: AdminRoundSummary[];
  selectedRound: null | {
    summary: AdminRoundSummary;
    round: RoundBundle;
    leaderboard: LeaderboardEntry[];
    targets: TeamTarget[];
    findings: Finding[];
    report: ReportSummary;
    waves: WaveRecord[];
    teamInstances: TeamInstanceRecord[];
    runtimeInspection: RuntimeRoundInspection;
    recentFlags: PersistedFlagRecord[];
    recentSubmissions: SubmissionRecord[];
    recentScoreEvents: ScoreEvent[];
    recentTraces: TraceEvent[];
    recentHeartbeats: HeartbeatRecord[];
    recentCheckerResults: CheckerResult[];
    activityFeed: AdminActivityItem[];
  };
}
