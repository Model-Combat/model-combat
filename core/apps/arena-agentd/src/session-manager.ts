import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  ArenaAgentFsApplyPatchRequest,
  ArenaAgentFsApplyPatchResponse,
  ArenaAgentFsListEntry,
  ArenaAgentFsListResponse,
  ArenaAgentFsReadResponse,
  ArenaAgentFsWriteRequest,
  ArenaAgentFsWriteResponse,
  ArenaAgentOpenSessionRequest,
  ArenaAgentSession,
} from "@model-combat/contracts";

import { PersistentShellSession } from "./shell-session.js";

interface ManagedSession {
  session: ArenaAgentSession;
  shell: PersistentShellSession;
}

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();

  async openSession(input: ArenaAgentOpenSessionRequest): Promise<ArenaAgentSession> {
    const sessionId = input.sessionId ?? randomUUID();
    const workspaceRoot = resolve(input.workspaceRoot);
    await mkdir(workspaceRoot, { recursive: true });

    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing.session;
    }

    const session: ArenaAgentSession = {
      sessionId,
      roundId: input.roundId,
      teamId: input.teamId,
      workspaceRoot,
      currentDirectory: workspaceRoot,
      openedAt: new Date().toISOString(),
    };

    const shell = new PersistentShellSession(workspaceRoot, input.initialEnvironment);
    this.sessions.set(sessionId, { session, shell });

    return session;
  }

  getSession(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`unknown session ${sessionId}`);
    }
    session.session.currentDirectory = session.shell.getCurrentDirectory();
    return session;
  }

  async fsRead(sessionId: string, inputPath: string, encoding: "utf8" | "base64"): Promise<ArenaAgentFsReadResponse> {
    const session = this.getSession(sessionId);
    const filePath = this.resolvePath(session, inputPath);
    const content = await readFile(filePath);

    return {
      path: filePath,
      encoding,
      content: encoding === "base64" ? content.toString("base64") : content.toString("utf8"),
      sizeBytes: content.byteLength,
    };
  }

  async fsList(
    sessionId: string,
    inputPath: string,
    recursive: boolean,
    maxEntries: number,
  ): Promise<ArenaAgentFsListResponse> {
    const session = this.getSession(sessionId);
    const rootPath = this.resolvePath(session, inputPath);
    const entries: ArenaAgentFsListEntry[] = [];

    const visit = async (currentPath: string): Promise<void> => {
      const dirEntries = await readdir(currentPath, { withFileTypes: true });

      for (const entry of dirEntries) {
        if (entries.length >= maxEntries) {
          return;
        }

        const fullPath = resolve(currentPath, entry.name);
        const info = await stat(fullPath).catch(() => null);
        const normalized: ArenaAgentFsListEntry = {
          path: fullPath,
          name: entry.name,
          type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : entry.isFile() ? "file" : "other",
          sizeBytes: info?.size ?? null,
        };
        entries.push(normalized);

        if (recursive && entry.isDirectory()) {
          await visit(fullPath);
        }
      }
    };

    await visit(rootPath);

    return {
      path: rootPath,
      entries,
    };
  }

  async fsWrite(input: ArenaAgentFsWriteRequest): Promise<ArenaAgentFsWriteResponse> {
    const session = this.getSession(input.sessionId);
    const filePath = this.resolvePath(session, input.path);
    if (input.createDirectories) {
      await mkdir(dirname(filePath), { recursive: true });
    }

    const buffer = input.encoding === "base64" ? Buffer.from(input.content, "base64") : Buffer.from(input.content, "utf8");
    await writeFile(filePath, buffer);

    return {
      path: filePath,
      sizeBytes: buffer.byteLength,
    };
  }

  async fsApplyPatch(input: ArenaAgentFsApplyPatchRequest): Promise<ArenaAgentFsApplyPatchResponse> {
    const session = this.getSession(input.sessionId);
    const filePath = this.resolvePath(session, input.path);
    if (input.createIfMissing) {
      await mkdir(dirname(filePath), { recursive: true });
    }

    let content = await readFile(filePath, "utf8").catch(() => {
      if (input.createIfMissing) {
        return "";
      }
      throw new Error(`cannot patch missing file ${filePath}`);
    });

    let operationsApplied = 0;
    for (const operation of input.operations) {
      if (operation.replaceAll) {
        if (content.includes(operation.search)) {
          content = content.split(operation.search).join(operation.replace);
          operationsApplied += 1;
        }
        continue;
      }

      if (!content.includes(operation.search)) {
        throw new Error(`search text not found in ${filePath}`);
      }
      content = content.replace(operation.search, operation.replace);
      operationsApplied += 1;
    }

    await writeFile(filePath, content, "utf8");

    return {
      path: filePath,
      operationsApplied,
      sizeBytes: Buffer.byteLength(content),
    };
  }

  private resolvePath(session: ManagedSession, inputPath: string): string {
    const basePath = inputPath.startsWith("/")
      ? resolve(inputPath)
      : resolve(session.session.currentDirectory, inputPath);

    if (!basePath.startsWith(session.session.workspaceRoot)) {
      throw new Error(`path ${inputPath} escapes workspace root ${session.session.workspaceRoot}`);
    }

    return basePath;
  }
}
