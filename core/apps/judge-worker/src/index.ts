import { NativeConnection, Worker } from "@temporalio/worker";

import * as activities from "./activities.js";

async function main(): Promise<void> {
  const temporalAddress = process.env.TEMPORAL_ADDRESS;

  if (!temporalAddress) {
    console.log("TEMPORAL_ADDRESS is not set; worker bootstrap is scaffolded but not started.");
    return;
  }

  const connection = await NativeConnection.connect({
    address: temporalAddress,
  });

  const worker = await Worker.create({
    connection,
    workflowsPath: new URL("./workflows.js", import.meta.url).pathname,
    activities,
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "model-combat",
  });

  await worker.run();
}

await main();
