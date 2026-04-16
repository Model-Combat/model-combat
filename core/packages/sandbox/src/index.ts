import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

import type { CheckerJob, CheckerResult } from "@model-combat/contracts";

export interface SandboxLimits {
  cpuShares: number;
  memoryMb: number;
  timeoutSeconds: number;
  diskMb: number;
}

export interface SandboxJobSpec {
  checkerJob: CheckerJob;
  limits: SandboxLimits;
  allowlistedHosts: string[];
}

type SandboxBackend = "process" | "docker";

export async function executeSandboxJob(spec: SandboxJobSpec): Promise<CheckerResult> {
  const backend = (process.env.SANDBOX_BACKEND as SandboxBackend | undefined) ?? "process";
  const startedAt = new Date().toISOString();

  const execution = backend === "docker"
    ? await runDockerSandbox(spec)
    : await runProcessSandbox(spec);

  return {
    jobId: spec.checkerJob.jobId,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...execution,
  };
}

async function runProcessSandbox(spec: SandboxJobSpec): Promise<Omit<CheckerResult, "jobId" | "startedAt" | "finishedAt">> {
  return new Promise((resolveResult) => {
    const cwd = dirname(resolve(spec.checkerJob.scriptPath));
    const child = spawn("/bin/bash", [resolve(spec.checkerJob.scriptPath)], {
      cwd,
      env: {
        ...process.env,
        ...spec.checkerJob.env,
        MODEL_COMBAT_TARGET_URL: spec.checkerJob.targetUrl,
        MODEL_COMBAT_ALLOWLISTED_HOSTS: spec.allowlistedHosts.join(","),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      if (!finished) {
        child.kill("SIGKILL");
      }
    }, spec.limits.timeoutSeconds * 1000);

    child.on("error", (error) => {
      finished = true;
      clearTimeout(timeout);
      resolveResult({
        success: false,
        exitCode: 127,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });

    child.on("exit", (code, signal) => {
      finished = true;
      clearTimeout(timeout);
      resolveResult({
        success: code === 0,
        exitCode: code ?? (signal ? 137 : 1),
        stdout,
        stderr,
      });
    });
  });
}

async function runDockerSandbox(spec: SandboxJobSpec): Promise<Omit<CheckerResult, "jobId" | "startedAt" | "finishedAt">> {
  return new Promise((resolveResult) => {
    const dockerImage = process.env.SANDBOX_DOCKER_IMAGE ?? "ubuntu:24.04";
    const dockerNetwork = process.env.SANDBOX_DOCKER_NETWORK;
    const cwd = dirname(resolve(spec.checkerJob.scriptPath));
    const scriptName = spec.checkerJob.scriptPath.split("/").at(-1) ?? spec.checkerJob.scriptPath;
    const args = [
      "run",
      "--rm",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=128m",
      "-v",
      `${cwd}:/workspace:ro`,
      "-w",
      "/workspace",
      "-e",
      `MODEL_COMBAT_TARGET_URL=${spec.checkerJob.targetUrl}`,
      "-e",
      `MODEL_COMBAT_ALLOWLISTED_HOSTS=${spec.allowlistedHosts.join(",")}`,
      ...Object.entries(spec.checkerJob.env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    ];

    if (dockerNetwork) {
      args.push("--network", dockerNetwork);
    }

    args.push(dockerImage, "/bin/bash", `/workspace/${scriptName}`);

    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      if (!finished) {
        child.kill("SIGKILL");
      }
    }, spec.limits.timeoutSeconds * 1000);

    child.on("error", (error) => {
      finished = true;
      clearTimeout(timeout);
      resolveResult({
        success: false,
        exitCode: 127,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });

    child.on("exit", (code, signal) => {
      finished = true;
      clearTimeout(timeout);
      resolveResult({
        success: code === 0,
        exitCode: code ?? (signal ? 137 : 1),
        stdout,
        stderr,
      });
    });
  });
}
