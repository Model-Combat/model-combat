import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { ArenaAgentShellExecResponse } from "@model-combat/contracts";

interface PendingCommand {
  id: string;
  stdout: string;
  stderr: string;
  resolve: (result: ArenaAgentShellExecResponse) => void;
  reject: (error: Error) => void;
  stdoutDone: boolean;
  stderrDone: boolean;
  startedAt: string;
  timeoutHandle: NodeJS.Timeout;
}

export class PersistentShellSession {
  private process: ChildProcessWithoutNullStreams;
  private currentDirectory: string;
  private pendingCommand: PendingCommand | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly environment: Record<string, string>;

  constructor(private readonly workspaceRoot: string, initialEnvironment: Record<string, string>) {
    this.currentDirectory = workspaceRoot;
    this.environment = { ...initialEnvironment };
    this.process = this.spawnShell(this.currentDirectory);
  }

  getCurrentDirectory(): string {
    return this.currentDirectory;
  }

  async run(command: string, timeoutSeconds: number): Promise<ArenaAgentShellExecResponse> {
    const task = this.queue.then(() => this.execute(command, timeoutSeconds));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  async dispose(): Promise<void> {
    this.process.kill("SIGKILL");
  }

  private spawnShell(cwd: string): ChildProcessWithoutNullStreams {
    const shell = spawn("/bin/bash", ["--noprofile", "--norc"], {
      cwd,
      env: {
        ...process.env,
        ...this.environment,
      },
      stdio: "pipe",
    });

    shell.stdout.setEncoding("utf8");
    shell.stderr.setEncoding("utf8");
    shell.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    shell.stderr.on("data", (chunk: string) => this.handleStderr(chunk));
    shell.on("exit", () => {
      if (this.pendingCommand) {
        const pending = this.pendingCommand;
        this.pendingCommand = null;
        clearTimeout(pending.timeoutHandle);
        pending.reject(new Error("persistent shell exited unexpectedly"));
      }
    });

    return shell;
  }

  private async execute(command: string, timeoutSeconds: number): Promise<ArenaAgentShellExecResponse> {
    const id = randomUUID();
    const startedAt = new Date().toISOString();

    return new Promise<ArenaAgentShellExecResponse>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.restartShell();
        resolve({
          commandId: id,
          exitCode: 124,
          stdout: this.pendingCommand?.stdout ?? "",
          stderr: `${this.pendingCommand?.stderr ?? ""}\ncommand timed out after ${timeoutSeconds} seconds`.trim(),
          currentDirectory: this.currentDirectory,
          startedAt,
          finishedAt: new Date().toISOString(),
          timedOut: true,
        });
      }, timeoutSeconds * 1000);

      this.pendingCommand = {
        id,
        stdout: "",
        stderr: "",
        resolve,
        reject,
        stdoutDone: false,
        stderrDone: false,
        startedAt,
        timeoutHandle,
      };

      const shellScript = [
        "{",
        command,
        "} ",
        "status=$?",
        "pwd_value=\"$(pwd)\"",
        `printf "\\n__MC_STDOUT_END__${id}:%s:%s\\n" "$status" "$pwd_value"`,
        `printf "\\n__MC_STDERR_END__${id}\\n" >&2`,
      ].join("\n");

      this.process.stdin.write(`${shellScript}\n`);
    });
  }

  private handleStdout(chunk: string): void {
    if (!this.pendingCommand) {
      return;
    }

    const marker = `__MC_STDOUT_END__${this.pendingCommand.id}:`;
    this.pendingCommand.stdout += chunk;

    const markerIndex = this.pendingCommand.stdout.indexOf(marker);
    if (markerIndex === -1) {
      return;
    }

    const beforeMarker = this.pendingCommand.stdout.slice(0, markerIndex);
    const afterMarker = this.pendingCommand.stdout.slice(markerIndex + marker.length);
    const newlineIndex = afterMarker.indexOf("\n");
    if (newlineIndex === -1) {
      return;
    }

    const metadata = afterMarker.slice(0, newlineIndex).split(":");
    const exitCode = Number(metadata[0] ?? "1");
    const nextDirectory = metadata.slice(1).join(":") || this.currentDirectory;

    this.pendingCommand.stdout = beforeMarker;
    this.currentDirectory = nextDirectory;
    this.pendingCommand.stdoutDone = true;
    this.maybeResolve(exitCode);
  }

  private handleStderr(chunk: string): void {
    if (!this.pendingCommand) {
      return;
    }

    const marker = `__MC_STDERR_END__${this.pendingCommand.id}`;
    this.pendingCommand.stderr += chunk;
    const markerIndex = this.pendingCommand.stderr.indexOf(marker);
    if (markerIndex === -1) {
      return;
    }

    this.pendingCommand.stderr = this.pendingCommand.stderr.slice(0, markerIndex);
    this.pendingCommand.stderrDone = true;
    this.maybeResolve();
  }

  private maybeResolve(exitCode?: number): void {
    if (!this.pendingCommand || !this.pendingCommand.stdoutDone || !this.pendingCommand.stderrDone) {
      return;
    }

    const pending = this.pendingCommand;
    this.pendingCommand = null;
    clearTimeout(pending.timeoutHandle);
    pending.resolve({
      commandId: pending.id,
      exitCode: exitCode ?? 0,
      stdout: pending.stdout.trimEnd(),
      stderr: pending.stderr.trimEnd(),
      currentDirectory: this.currentDirectory,
      startedAt: pending.startedAt,
      finishedAt: new Date().toISOString(),
      timedOut: false,
    });
  }

  private restartShell(): void {
    this.process.kill("SIGKILL");
    this.pendingCommand = null;
    this.process = this.spawnShell(this.currentDirectory);
  }
}
