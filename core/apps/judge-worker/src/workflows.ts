import { proxyActivities } from "@temporalio/workflow";

import type * as activities from "./activities.js";

const activity = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
});

export async function QualifyRepoTemplateWorkflow(serviceId: string) {
  return activity.qualifyRepoTemplate(serviceId);
}

export async function CreateRoundWorkflow() {
  const round = await activity.createRound();
  await activity.freezeRoundBundle(round);
  return round;
}

export async function SeedRepoWorkflow(service: Parameters<typeof activity.seedRepo>[0]) {
  return activity.seedRepo(service);
}

export async function VerifyFindingWorkflow(finding: Parameters<typeof activity.verifyFinding>[0]) {
  return activity.verifyFinding(finding);
}

export async function FreezeRoundBundleWorkflow(round: Parameters<typeof activity.freezeRoundBundle>[0]) {
  return activity.freezeRoundBundle(round);
}

export async function PublishRoundReposWorkflow(roundId: string) {
  return activity.publishRoundRepos(roundId);
}

export async function ProvisionTeamsWorkflow(input: {
  roundId: string;
  runtimeBackend: Parameters<typeof activity.provisionTeams>[0]["runtimeBackend"];
  services: Parameters<typeof activity.provisionTeams>[0]["services"];
}) {
  return activity.provisionTeams(input);
}

export async function RunRoundWorkflow(roundId: string) {
  return activity.runRound(roundId);
}

export async function FinalizeRoundWorkflow(roundId: string) {
  return activity.finalizeRound(roundId);
}
