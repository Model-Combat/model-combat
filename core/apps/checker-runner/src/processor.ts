import type { Job } from "bullmq";

import { checkerJobSchema, type CheckerJob, type CheckerResult } from "@model-combat/contracts";
import { executeSandboxJob } from "@model-combat/sandbox";

export async function processCheckerJob(job: Job<CheckerJob>): Promise<CheckerResult> {
  const checkerJob = checkerJobSchema.parse(job.data);

  return executeSandboxJob({
    checkerJob,
    limits: {
      cpuShares: 1024,
      memoryMb: 512,
      timeoutSeconds: checkerJob.timeoutSeconds,
      diskMb: 256,
    },
    allowlistedHosts: [new URL(checkerJob.targetUrl).host],
  });
}
