import { startTransition, useDeferredValue, useEffect, useEffectEvent, useMemo, useState } from "react";
import type { FormEvent } from "react";

import type {
  AdminDashboardSnapshot,
  ExecutionBackend,
  LeaderboardEntry,
  RuntimeInstanceInspection,
} from "./types";

type BackendKind = ExecutionBackend;

interface CreateRoundFormState {
  requestedBy: string;
  notes: string;
  backendKind: BackendKind;
  networkNamePrefix: string;
  baseImage: string;
  hostWorkspaceRoot: string;
  agentdPort: string;
  region: string;
  accountPool: string;
  instanceProfile: string;
}

const refreshIntervalMs = 3000;
const defaultCreateRoundForm: CreateRoundFormState = {
  requestedBy: "admin-dashboard",
  notes: "",
  backendKind: "docker-local",
  networkNamePrefix: "model-combat",
  baseImage: "model-combat/arena-agentd:local",
  hostWorkspaceRoot: "/tmp/model-combat-local",
  agentdPort: "9000",
  region: "us-east-1",
  accountPool: "",
  instanceProfile: "",
};

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `request failed with status ${response.status}`);
  }

  return await response.json() as T;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "not started";
  }

  return new Date(value).toLocaleString();
}

function formatRelative(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }

  const diffMs = Date.now() - new Date(value).getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function statusTone(status: string): "good" | "warn" | "bad" | "neutral" {
  if (status === "running" || status === "provisioned" || status === "completed" || status === "active") {
    return "good";
  }
  if (status === "paused" || status === "draft" || status === "unknown") {
    return "warn";
  }
  if (status === "aborted" || status === "finalized" || status === "missing" || status === "exited") {
    return "bad";
  }
  return "neutral";
}

function scoreTone(score: number): "good" | "warn" | "bad" {
  if (score > 0) {
    return "good";
  }
  if (score < 0) {
    return "bad";
  }
  return "warn";
}

function buildCreateRoundRequest(form: CreateRoundFormState): Record<string, unknown> {
  const runtimeBackend = form.backendKind === "docker-local"
    ? {
      kind: "docker-local",
      networkNamePrefix: form.networkNamePrefix,
      baseImage: form.baseImage,
      hostWorkspaceRoot: form.hostWorkspaceRoot || undefined,
      agentdPort: Number(form.agentdPort || "9000"),
    }
    : {
      kind: "aws-ec2",
      region: form.region,
      accountPool: form.accountPool
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
      instanceProfile: form.instanceProfile || undefined,
    };

  return {
    requestedBy: form.requestedBy,
    notes: form.notes,
    runtimeBackend,
  };
}

function statusLabel(status: string): string {
  return status.replaceAll("-", " ");
}

function RoundStat(props: { label: string; value: string | number; tone?: "good" | "warn" | "bad" | "neutral" }) {
  return (
    <article className="metric-card">
      <div className="metric-label">{props.label}</div>
      <div className={`metric-value tone-${props.tone ?? "neutral"}`}>{props.value}</div>
    </article>
  );
}

function Pill(props: { label: string; tone?: "good" | "warn" | "bad" | "neutral" }) {
  return <span className={`pill tone-${props.tone ?? "neutral"}`}>{props.label}</span>;
}

function EmptyState(props: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <h3>{props.title}</h3>
      <p>{props.body}</p>
    </div>
  );
}

function RuntimeCard(props: { instance: RuntimeInstanceInspection }) {
  const { instance } = props;

  return (
    <article className="runtime-card">
      <div className="runtime-header">
        <div>
          <h3>{instance.teamId}</h3>
          <p className="muted mono">{instance.instanceId}</p>
        </div>
        <Pill label={instance.state} tone={statusTone(instance.state)} />
      </div>
      <div className="runtime-meta">
        <span>{instance.address}</span>
        <span>{instance.agentdUrl}</span>
      </div>
      <p className="muted">{instance.statusText}</p>
      <div className="service-list">
        {instance.services.map((service) => (
          <div className="service-row" key={`${instance.teamId}-${service.serviceId}`}>
            <div className="service-main">
              <span className="service-name">{service.displayName ?? service.serviceId}</span>
              <span className="muted mono">:{service.port ?? "?"}</span>
            </div>
            <div className="service-pills">
              <Pill
                label={service.running == null ? "unknown" : service.running ? "running" : "stopped"}
                tone={service.running == null ? "warn" : service.running ? "good" : "bad"}
              />
              <Pill label={`restarts ${service.restartCount ?? 0}`} tone="neutral" />
              {service.lastExitCode != null ? <Pill label={`exit ${service.lastExitCode}`} tone={service.lastExitCode === 0 ? "good" : "bad"} /> : null}
            </div>
            {service.error ? <div className="service-error">{service.error}</div> : null}
            {service.logs && service.logs.length > 0 ? <pre className="log-block">{service.logs.join("\n")}</pre> : null}
          </div>
        ))}
      </div>
      {instance.logs.length > 0 ? <pre className="log-block">{instance.logs.join("\n")}</pre> : null}
      {instance.errors.length > 0 ? (
        <div className="error-list">
          {instance.errors.map((error, index) => (
            <div className="service-error" key={`${instance.teamId}-error-${index}`}>{error}</div>
          ))}
        </div>
      ) : null}
      <details className="details">
        <summary>Instance metadata</summary>
        <pre className="json-block">{JSON.stringify(instance.metadata, null, 2)}</pre>
      </details>
    </article>
  );
}

function scoreWidth(entries: LeaderboardEntry[], score: number): string {
  const max = Math.max(...entries.map((entry) => Math.abs(entry.score)), 1);
  return `${Math.max(12, Math.round((Math.abs(score) / max) * 100))}%`;
}

export function App() {
  const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot | null>(null);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [createRoundForm, setCreateRoundForm] = useState<CreateRoundFormState>(defaultCreateRoundForm);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refreshSnapshot = useEffectEvent(async (preferredRoundId?: string | null, silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const roundId = preferredRoundId ?? selectedRoundId;
      const query = roundId ? `?roundId=${encodeURIComponent(roundId)}` : "";
      const nextSnapshot = await fetchJson<AdminDashboardSnapshot>(`/api/v1/admin/dashboard${query}`);

      startTransition(() => {
        setSnapshot(nextSnapshot);
        setError(null);

        const nextSelectedRoundId = roundId
          ?? nextSnapshot.selectedRound?.summary.roundId
          ?? nextSnapshot.currentRoundId
          ?? nextSnapshot.rounds[0]?.roundId
          ?? null;

        if (nextSelectedRoundId !== selectedRoundId) {
          setSelectedRoundId(nextSelectedRoundId);
        }
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "failed to load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  });

  useEffect(() => {
    void refreshSnapshot(selectedRoundId, snapshot !== null);
    const interval = window.setInterval(() => {
      void refreshSnapshot(selectedRoundId, true);
    }, refreshIntervalMs);

    return () => window.clearInterval(interval);
  }, [selectedRoundId, snapshot !== null, refreshSnapshot]);

  const selectedRound = snapshot?.selectedRound ?? null;
  const deferredActivityFeed = useDeferredValue(selectedRound?.activityFeed ?? []);
  const leaderboard = selectedRound?.leaderboard ?? [];
  const runtimeInstances = selectedRound?.runtimeInspection.instances ?? [];
  const targetList = selectedRound?.targets ?? [];
  const selectedRoundSummary = selectedRound?.summary ?? null;
  const currentRound = snapshot?.rounds.find((round) => round.roundId === snapshot.currentRoundId) ?? null;
  const hasSelectedRound = Boolean(selectedRoundSummary);

  const overviewStats = useMemo(() => {
    if (!selectedRound) {
      return [];
    }

    return [
      { label: "Current wave", value: `${selectedRound.summary.currentWave}/${selectedRound.summary.totalWaves}`, tone: "neutral" as const },
      { label: "Teams", value: selectedRound.summary.teamCount, tone: "neutral" as const },
      { label: "Flags tracked", value: selectedRound.recentFlags.length, tone: "warn" as const },
      { label: "Submissions", value: selectedRound.recentSubmissions.length, tone: "neutral" as const },
      { label: "Score events", value: selectedRound.recentScoreEvents.length, tone: "good" as const },
      { label: "Trace spans", value: selectedRound.recentTraces.length, tone: "neutral" as const },
    ];
  }, [selectedRound]);

  async function runRoundAction(path: string, successMessage: string, body?: Record<string, unknown>) {
    setBusyAction(path);
    setNotice(null);

    try {
      await fetchJson(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      setNotice(successMessage);
      await refreshSnapshot(selectedRoundId, false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "action failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("create-round");
    setNotice(null);

    try {
      const response = await fetchJson<{ round: { roundId: string } }>("/api/v1/admin/rounds", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(buildCreateRoundRequest(createRoundForm)),
      });
      setSelectedRoundId(response.round.roundId);
      setNotice(`Created ${response.round.roundId}`);
      await refreshSnapshot(response.round.roundId, false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "failed to create round");
    } finally {
      setBusyAction(null);
    }
  }

  function updateCreateRoundForm<Key extends keyof CreateRoundFormState>(key: Key, value: CreateRoundFormState[Key]) {
    setCreateRoundForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div>
            <div className="eyebrow">Model Combat</div>
            <h1>Judge Control Room</h1>
          </div>
          <button className="button button-secondary" onClick={() => void refreshSnapshot(selectedRoundId, false)} type="button">
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Current round</h2>
              <p className="muted">Judge-wide view of the active round clock.</p>
            </div>
          </div>
          {snapshot?.currentWave ? (
            <div className="current-round-card">
              <div className="stack">
                <Pill label={snapshot.currentWave.status} tone={statusTone(snapshot.currentWave.status)} />
                {currentRound ? <Pill label={currentRound.backend} tone="neutral" /> : null}
              </div>
              <div className="big-metric">{snapshot.currentWave.waveNumber}</div>
              <div className="muted">of {snapshot.currentWave.totalWaves} waves</div>
              <div className="detail-row">
                <span>Round</span>
                <span className="mono">{snapshot.currentWave.roundId}</span>
              </div>
              <div className="detail-row">
                <span>Updated</span>
                <span>{formatRelative(snapshot.generatedAt)}</span>
              </div>
            </div>
          ) : (
            <EmptyState title="No live round" body="Create a round from this panel and provision a runtime backend." />
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Rounds</h2>
              <p className="muted">Select any round to inspect runtime state and logs.</p>
            </div>
          </div>
          <div className="round-list">
            {(snapshot?.rounds ?? []).map((round) => (
              <button
                className={`round-item ${selectedRoundId === round.roundId ? "round-item-active" : ""}`}
                key={round.roundId}
                onClick={() => setSelectedRoundId(round.roundId)}
                type="button"
              >
                <div className="round-item-top">
                  <strong>{round.roundId}</strong>
                  <Pill label={round.status} tone={statusTone(round.status)} />
                </div>
                <div className="round-item-meta">
                  <span>{round.backend}</span>
                  <span>{round.currentWave}/{round.totalWaves} waves</span>
                </div>
                <div className="round-item-services">{round.serviceIds.join(" · ")}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Create round</h2>
              <p className="muted">Bootstrap a new seeded round directly from the control plane.</p>
            </div>
          </div>
          <form className="create-form" onSubmit={handleCreateRound}>
            <label className="field">
              <span>Requested by</span>
              <input value={createRoundForm.requestedBy} onChange={(event) => updateCreateRoundForm("requestedBy", event.target.value)} />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea rows={3} value={createRoundForm.notes} onChange={(event) => updateCreateRoundForm("notes", event.target.value)} />
            </label>
            <label className="field">
              <span>Backend</span>
              <select value={createRoundForm.backendKind} onChange={(event) => updateCreateRoundForm("backendKind", event.target.value as BackendKind)}>
                <option value="docker-local">docker-local</option>
                <option value="aws-ec2">aws-ec2</option>
              </select>
            </label>

            {createRoundForm.backendKind === "docker-local" ? (
              <>
                <label className="field">
                  <span>Network prefix</span>
                  <input value={createRoundForm.networkNamePrefix} onChange={(event) => updateCreateRoundForm("networkNamePrefix", event.target.value)} />
                </label>
                <label className="field">
                  <span>Base image</span>
                  <input value={createRoundForm.baseImage} onChange={(event) => updateCreateRoundForm("baseImage", event.target.value)} />
                </label>
                <label className="field">
                  <span>Host workspace root</span>
                  <input value={createRoundForm.hostWorkspaceRoot} onChange={(event) => updateCreateRoundForm("hostWorkspaceRoot", event.target.value)} />
                </label>
                <label className="field">
                  <span>Agentd port</span>
                  <input value={createRoundForm.agentdPort} onChange={(event) => updateCreateRoundForm("agentdPort", event.target.value)} />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>AWS region</span>
                  <input value={createRoundForm.region} onChange={(event) => updateCreateRoundForm("region", event.target.value)} />
                </label>
                <label className="field">
                  <span>Account pool</span>
                  <input value={createRoundForm.accountPool} onChange={(event) => updateCreateRoundForm("accountPool", event.target.value)} placeholder="acct-a, acct-b" />
                </label>
                <label className="field">
                  <span>Instance profile</span>
                  <input value={createRoundForm.instanceProfile} onChange={(event) => updateCreateRoundForm("instanceProfile", event.target.value)} />
                </label>
              </>
            )}

            <button className="button button-primary" disabled={busyAction === "create-round"} type="submit">
              {busyAction === "create-round" ? "Creating..." : "Create round"}
            </button>
          </form>
        </section>
      </aside>

      <main className="main-content">
        <header className="hero">
          <div>
            <div className="eyebrow">Admin dashboard</div>
            <h2>Runtime introspection, scoring, and operator controls</h2>
            <p className="hero-copy">
              Use this panel to create rounds, inspect container and service health, watch flag traffic, and trigger round
              lifecycle actions without dropping into raw curl logs.
            </p>
          </div>
          <div className="hero-status">
            {selectedRoundSummary ? <Pill label={selectedRoundSummary.status} tone={statusTone(selectedRoundSummary.status)} /> : null}
            {selectedRoundSummary ? <Pill label={selectedRoundSummary.backend} tone="neutral" /> : null}
            <span className="muted">Last refresh {snapshot ? formatRelative(snapshot.generatedAt) : "never"}</span>
          </div>
        </header>

        {error ? <div className="banner banner-error">{error}</div> : null}
        {notice ? <div className="banner banner-info">{notice}</div> : null}

        {!loading && !hasSelectedRound ? (
          <EmptyState title="No round selected" body="Create a round or choose one from the left rail to start debugging runtime state." />
        ) : null}

        {loading && !snapshot ? (
          <EmptyState title="Loading dashboard" body="Fetching the first control-plane snapshot." />
        ) : null}

        {selectedRound ? (
          <>
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Round controls</h2>
                  <p className="muted">Operate the selected round directly from the judge.</p>
                </div>
                <div className="control-strip">
                  <button className="button button-secondary" disabled={!selectedRoundId || busyAction !== null} onClick={() => selectedRoundId && void runRoundAction(`/api/v1/admin/rounds/${selectedRoundId}/provision`, "Provisioned round")} type="button">Provision</button>
                  <button className="button button-primary" disabled={!selectedRoundId || busyAction !== null} onClick={() => selectedRoundId && void runRoundAction(`/api/v1/admin/rounds/${selectedRoundId}/start`, "Started round")} type="button">Start</button>
                  <button className="button button-secondary" disabled={!selectedRoundId || busyAction !== null} onClick={() => selectedRoundId && void runRoundAction(`/api/v1/admin/rounds/${selectedRoundId}/advance-wave`, "Advanced wave")} type="button">Advance wave</button>
                  <button className="button button-secondary" disabled={!selectedRoundId || busyAction !== null} onClick={() => selectedRoundId && void runRoundAction(`/api/v1/admin/rounds/${selectedRoundId}/pause`, "Paused round")} type="button">Pause</button>
                  <button className="button button-secondary" disabled={!selectedRoundId || busyAction !== null} onClick={() => selectedRoundId && void runRoundAction(`/api/v1/admin/rounds/${selectedRoundId}/finalize`, "Finalized round")} type="button">Finalize</button>
                  <button className="button button-danger" disabled={!selectedRoundId || busyAction !== null} onClick={() => selectedRoundId && void runRoundAction(`/api/v1/admin/rounds/${selectedRoundId}/abort`, "Aborted round")} type="button">Abort</button>
                </div>
              </div>
              <div className="metrics-grid">
                {overviewStats.map((metric) => (
                  <RoundStat key={metric.label} label={metric.label} tone={metric.tone} value={metric.value} />
                ))}
              </div>
              <div className="round-facts">
                <div className="fact">
                  <span>Started</span>
                  <strong>{formatDate(selectedRound.summary.startedAt)}</strong>
                </div>
                <div className="fact">
                  <span>Ended</span>
                  <strong>{formatDate(selectedRound.summary.endedAt)}</strong>
                </div>
                <div className="fact">
                  <span>Winner</span>
                  <strong>{selectedRound.report.winningTeamId}</strong>
                </div>
                <div className="fact">
                  <span>Runtime image</span>
                  <strong className="mono">{selectedRound.round.runtimeImageRef}</strong>
                </div>
              </div>
            </section>

            <div className="dashboard-grid two-up">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Leaderboard</h2>
                    <p className="muted">Score deltas are built from append-only events.</p>
                  </div>
                </div>
                {leaderboard.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th>Score</th>
                          <th>Services up</th>
                          <th>Flags stolen</th>
                          <th>Flags lost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaderboard.map((entry) => (
                          <tr key={entry.teamId}>
                            <td>{entry.teamId}</td>
                            <td>
                              <div className="score-cell">
                                <strong className={`tone-${scoreTone(entry.score)}`}>{entry.score}</strong>
                                <div className="score-bar">
                                  <div className={`score-bar-fill tone-${scoreTone(entry.score)}`} style={{ width: scoreWidth(leaderboard, entry.score) }} />
                                </div>
                              </div>
                            </td>
                            <td>{entry.servicesUp}</td>
                            <td>{entry.flagsStolen}</td>
                            <td>{entry.flagsLost}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="No score events yet" body="Start the round or advance a wave to populate the leaderboard." />
                )}
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Wave clock</h2>
                    <p className="muted">Judge timing, status, and target addressing.</p>
                  </div>
                </div>
                <div className="wave-strip">
                  {selectedRound.waves.map((wave) => (
                    <div className={`wave-chip tone-${statusTone(wave.status)}`} key={wave.waveNumber}>
                      <strong>Wave {wave.waveNumber}</strong>
                      <span>{statusLabel(wave.status)}</span>
                      <span className="muted">{formatRelative(wave.startedAt)}</span>
                    </div>
                  ))}
                </div>
                <div className="target-list">
                  {targetList.map((target) => (
                    <div className="target-row" key={target.teamId}>
                      <span>{target.teamId}</span>
                      <span className="mono">{target.ip}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Runtime inspection</h2>
                  <p className="muted">
                    Container state, daemon reachability, and service-level logs. Network: {selectedRound.runtimeInspection.networkId ?? "n/a"}.
                  </p>
                </div>
                <span className="muted">Collected {formatRelative(selectedRound.runtimeInspection.collectedAt)}</span>
              </div>
              <div className="runtime-grid">
                {runtimeInstances.map((instance) => (
                  <RuntimeCard instance={instance} key={instance.instanceId} />
                ))}
              </div>
            </section>

            <div className="dashboard-grid two-up">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Activity feed</h2>
                    <p className="muted">Interleaved score, trace, checker, heartbeat, and wave events.</p>
                  </div>
                </div>
                <div className="activity-feed">
                  {deferredActivityFeed.slice(0, 80).map((item) => (
                    <article className="activity-item" key={item.id}>
                      <div className="activity-top">
                        <Pill label={item.kind} tone="neutral" />
                        <span className="muted">{formatDate(item.timestamp)}</span>
                      </div>
                      <strong>{item.message}</strong>
                      <div className="activity-meta">
                        {item.teamId ? <span>{item.teamId}</span> : null}
                        {item.serviceId ? <span>{item.serviceId}</span> : null}
                      </div>
                      <pre className="json-block">{JSON.stringify(item.details, null, 2)}</pre>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Round bundle</h2>
                    <p className="muted">Selected round metadata, services, seed roster, and findings.</p>
                  </div>
                </div>
                <div className="bundle-grid">
                  <div className="bundle-card">
                    <h3>Services</h3>
                    <div className="stack-list">
                      {selectedRound.round.serviceTemplates.map((service) => (
                        <div className="bundle-line" key={service.serviceId}>
                          <strong>{service.displayName}</strong>
                          <span className="muted">{service.bucket} · {service.protocol} · :{service.port}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bundle-card">
                    <h3>Models</h3>
                    <div className="stack-list">
                      {selectedRound.round.seedModels.concat(selectedRound.round.competitorRoster).map((model) => (
                        <div className="bundle-line" key={`${model.role}-${model.slot}-${model.model}`}>
                          <strong>{model.model}</strong>
                          <span className="muted">{model.provider} · {model.role}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bundle-card">
                    <h3>Findings</h3>
                    <div className="stack-list">
                      {selectedRound.findings.map((finding) => (
                        <div className="bundle-line" key={finding.findingId}>
                          <strong>{finding.serviceId}</strong>
                          <span className="muted">{finding.category} · {finding.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <details className="details">
                  <summary>Raw round JSON</summary>
                  <pre className="json-block">{JSON.stringify(selectedRound.round, null, 2)}</pre>
                </details>
              </section>
            </div>

            <div className="dashboard-grid two-up">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Recent score events</h2>
                    <p className="muted">Latest immutable score deltas for the selected round.</p>
                  </div>
                </div>
                <div className="table-wrap compact">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Team</th>
                        <th>Service</th>
                        <th>Type</th>
                        <th>Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRound.recentScoreEvents.map((event) => (
                        <tr key={event.eventId}>
                          <td>{formatDate(event.createdAt)}</td>
                          <td>{event.teamId}</td>
                          <td>{event.serviceId}</td>
                          <td>{event.type}</td>
                          <td className={`tone-${scoreTone(event.delta)}`}>{event.delta}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Recent submissions</h2>
                    <p className="muted">Flag submission outcomes for debugging judge validation.</p>
                  </div>
                </div>
                <div className="table-wrap compact">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Team</th>
                        <th>Status</th>
                        <th>Flag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRound.recentSubmissions.map((submission) => (
                        <tr key={submission.submissionId}>
                          <td>{formatDate(submission.createdAt)}</td>
                          <td>{submission.teamId}</td>
                          <td><Pill label={submission.status} tone={statusTone(submission.status)} /></td>
                          <td className="mono">{submission.submittedFlag.slice(0, 38)}...</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="dashboard-grid two-up">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Trace spans</h2>
                    <p className="muted">Latest agent tool/model events ingested by the judge.</p>
                  </div>
                </div>
                <div className="activity-feed compact-feed">
                  {selectedRound.recentTraces.map((trace) => (
                    <article className="activity-item" key={trace.spanId}>
                      <div className="activity-top">
                        <Pill label={trace.eventType} tone="neutral" />
                        <span className="muted">{formatDate(trace.timestamp)}</span>
                      </div>
                      <strong>{trace.teamId}</strong>
                      <pre className="json-block">{JSON.stringify(trace.attributes, null, 2)}</pre>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Checker and heartbeat logs</h2>
                    <p className="muted">Operational feedback from verification jobs and team heartbeats.</p>
                  </div>
                </div>
                <div className="stacked-panels">
                  <div className="subpanel">
                    <h3>Checker results</h3>
                    <div className="activity-feed compact-feed">
                      {selectedRound.recentCheckerResults.map((result) => (
                        <article className="activity-item" key={result.jobId}>
                          <div className="activity-top">
                            <Pill label={result.success ? "success" : "failure"} tone={result.success ? "good" : "bad"} />
                            <span className="muted">{formatDate(result.finishedAt)}</span>
                          </div>
                          <strong>{result.jobId}</strong>
                          <pre className="log-block">{[result.stdout, result.stderr].filter(Boolean).join("\n") || "no output"}</pre>
                        </article>
                      ))}
                    </div>
                  </div>
                  <div className="subpanel">
                    <h3>Heartbeats</h3>
                    <div className="activity-feed compact-feed">
                      {selectedRound.recentHeartbeats.map((heartbeat) => (
                        <article className="activity-item" key={`${heartbeat.teamId}-${heartbeat.receivedAt}`}>
                          <div className="activity-top">
                            <Pill label={heartbeat.teamId} tone="neutral" />
                            <span className="muted">{formatDate(heartbeat.receivedAt)}</span>
                          </div>
                          <pre className="json-block">{JSON.stringify(heartbeat.payload, null, 2)}</pre>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
