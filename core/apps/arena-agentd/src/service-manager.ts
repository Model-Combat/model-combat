import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { ArenaAgentServiceStatus, RuntimeServiceSpec } from "@model-combat/contracts";

interface ManagedServiceState {
  spec: RuntimeServiceSpec;
  child: ChildProcessWithoutNullStreams | null;
  restartCount: number;
  lastExitCode: number | null;
  logs: string[];
}

export class ServiceManager {
  private readonly services = new Map<string, ManagedServiceState>();

  constructor(specs: RuntimeServiceSpec[]) {
    for (const spec of specs) {
      this.services.set(spec.serviceId, {
        spec,
        child: null,
        restartCount: 0,
        lastExitCode: null,
        logs: [],
      });
    }
  }

  async startAll(): Promise<void> {
    for (const spec of this.services.values()) {
      if (spec.spec.startCommand) {
        await this.restart(spec.spec.serviceId);
      }
    }
  }

  async restart(serviceId: string): Promise<ArenaAgentServiceStatus> {
    const service = this.requireService(serviceId);

    if (service.child) {
      service.child.kill("SIGTERM");
      service.child = null;
    }

    service.restartCount += 1;

    if (!service.spec.startCommand) {
      return this.getStatus(serviceId);
    }

    const child = spawn("/bin/bash", ["-lc", service.spec.startCommand], {
      cwd: service.spec.workingDirectory,
      stdio: "pipe",
      env: process.env,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.appendLogs(service, chunk));
    child.stderr.on("data", (chunk: string) => this.appendLogs(service, chunk));
    child.on("exit", (code) => {
      service.lastExitCode = code;
      if (service.child?.pid === child.pid) {
        service.child = null;
      }
    });

    service.child = child;
    return this.getStatus(serviceId);
  }

  getStatus(serviceId: string): ArenaAgentServiceStatus {
    const service = this.requireService(serviceId);
    return {
      serviceId: service.spec.serviceId,
      running: Boolean(service.child && !service.child.killed),
      pid: service.child?.pid ?? null,
      restartCount: service.restartCount,
      lastExitCode: service.lastExitCode,
      port: service.spec.port,
      workingDirectory: service.spec.workingDirectory,
    };
  }

  getLogs(serviceId: string, tailLines: number): string[] {
    const service = this.requireService(serviceId);
    return service.logs.slice(-tailLines);
  }

  private appendLogs(service: ManagedServiceState, chunk: string): void {
    for (const line of chunk.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      service.logs.push(line);
    }
    if (service.logs.length > 2000) {
      service.logs.splice(0, service.logs.length - 2000);
    }
  }

  private requireService(serviceId: string): ManagedServiceState {
    const service = this.services.get(serviceId);
    if (!service) {
      throw new Error(`unknown service ${serviceId}`);
    }
    return service;
  }
}
