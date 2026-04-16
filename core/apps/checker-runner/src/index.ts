import { QueueEvents, Worker } from "bullmq";
import { Redis } from "ioredis";

import { processCheckerJob } from "./processor.js";

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    console.log("REDIS_URL is not set; checker runner scaffold is not starting.");
    return;
  }

  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  new QueueEvents("checker-jobs", { connection });

  const worker = new Worker("checker-jobs", processCheckerJob, {
    connection,
  });

  worker.on("completed", (job) => {
    console.log(`completed checker job ${job?.id ?? "unknown"}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`checker job ${job?.id ?? "unknown"} failed`, error);
  });
}

await main();
