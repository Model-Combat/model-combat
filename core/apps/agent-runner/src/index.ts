import { ArenaAgentClient, runAgentHarness } from "@model-combat/agent-runtime";
import { teamBootstrapResponseSchema } from "@model-combat/contracts";
import { createModelProviderFromEnv } from "@model-combat/integrations";
import { CompositeTraceSink, ConsoleTraceSink, JudgeTraceSink } from "@model-combat/telemetry";

async function main(): Promise<void> {
  const judgeUrl = process.env.JUDGE_URL ?? "http://127.0.0.1:4010";
  const teamId = process.env.TEAM_ID ?? "team-1";
  const modelName = process.env.MODEL_NAME ?? "stub-agent";
  const maxTurns = Number(process.env.MAX_TURNS ?? "25");
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? "/srv/model-combat";

  const bootstrapResponse = await fetch(
    new URL(`/api/v1/team/bootstrap?teamId=${encodeURIComponent(teamId)}`, judgeUrl),
  );
  if (!bootstrapResponse.ok) {
    throw new Error(`failed to fetch team bootstrap: ${bootstrapResponse.status}`);
  }

  const bootstrap = teamBootstrapResponseSchema.parse(await bootstrapResponse.json());
  const runtime = await resolveTeamRuntime(judgeUrl, teamId);
  const provider = createModelProviderFromEnv();
  const traceSink = new CompositeTraceSink([
    new ConsoleTraceSink(),
    new JudgeTraceSink(judgeUrl),
  ]);

  const result = await runAgentHarness(
    {
      judgeUrl,
      teamId,
      modelName,
      maxTurns,
      workspaceRoot,
    },
    {
      provider,
      traceSink,
      arenaAgentClient: new ArenaAgentClient({
        baseUrl: runtime.agentdUrl,
        authToken: runtime.authToken,
      }),
      bootstrap,
    },
  );

  console.log(JSON.stringify(result, null, 2));
}

async function resolveTeamRuntime(judgeUrl: string, teamId: string): Promise<{ agentdUrl: string; authToken?: string }> {
  if (process.env.AGENTD_URL) {
    return {
      agentdUrl: process.env.AGENTD_URL,
      authToken: process.env.AGENTD_AUTH_TOKEN,
    };
  }

  const response = await fetch(new URL(`/internal/team-runtime?teamId=${encodeURIComponent(teamId)}`, judgeUrl));
  if (!response.ok) {
    throw new Error(`failed to resolve team runtime: ${response.status}`);
  }

  const body = await response.json() as { agentdUrl: string; authToken?: string | null };
  return {
    agentdUrl: body.agentdUrl,
    authToken: body.authToken ?? undefined,
  };
}

await main();
