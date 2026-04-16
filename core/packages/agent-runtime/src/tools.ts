import type { ArenaAgentToolName } from "@model-combat/contracts";
import type { ModelToolDefinition } from "@model-combat/integrations";

export function buildHarnessToolDefinitions(): ModelToolDefinition[] {
  return [
    {
      name: "shell.exec",
      description: "Execute a shell command in the persistent team workspace shell.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          timeoutSeconds: { type: "integer", minimum: 1, maximum: 300 },
        },
        required: ["command"],
      },
    },
    {
      name: "fs.read",
      description: "Read a file from the team workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          encoding: { type: "string", enum: ["utf8", "base64"] },
        },
        required: ["path"],
      },
    },
    {
      name: "fs.list",
      description: "List files and directories in the team workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          recursive: { type: "boolean" },
          maxEntries: { type: "integer", minimum: 1, maximum: 5000 },
        },
        required: ["path"],
      },
    },
    {
      name: "fs.write",
      description: "Write or replace a file in the team workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          encoding: { type: "string", enum: ["utf8", "base64"] },
          createDirectories: { type: "boolean" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "fs.apply_patch",
      description: "Apply one or more search/replace patch operations to a file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          createIfMissing: { type: "boolean" },
          operations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                search: { type: "string" },
                replace: { type: "string" },
                replaceAll: { type: "boolean" },
              },
              required: ["search", "replace"],
            },
            minItems: 1,
          },
        },
        required: ["path", "operations"],
      },
    },
    {
      name: "service.restart",
      description: "Restart one benchmark service running in the team environment.",
      inputSchema: {
        type: "object",
        properties: {
          serviceId: { type: "string" },
        },
        required: ["serviceId"],
      },
    },
    {
      name: "service.status",
      description: "Get status for one benchmark service running in the team environment.",
      inputSchema: {
        type: "object",
        properties: {
          serviceId: { type: "string" },
        },
        required: ["serviceId"],
      },
    },
    {
      name: "service.logs",
      description: "Read recent logs for one benchmark service.",
      inputSchema: {
        type: "object",
        properties: {
          serviceId: { type: "string" },
          tailLines: { type: "integer", minimum: 1, maximum: 1000 },
        },
        required: ["serviceId"],
      },
    },
    {
      name: "net.http",
      description: "Send an HTTP request to a target service or API endpoint.",
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
          url: { type: "string" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          body: { type: "string" },
          timeoutSeconds: { type: "integer", minimum: 1, maximum: 120 },
        },
        required: ["url"],
      },
    },
    {
      name: "submit_flag",
      description: "Submit a captured flag to the judge.",
      inputSchema: {
        type: "object",
        properties: {
          flag: { type: "string" },
        },
        required: ["flag"],
      },
    },
  ];
}

export function isHarnessToolName(value: string): value is ArenaAgentToolName {
  return [
    "shell.exec",
    "fs.read",
    "fs.list",
    "fs.write",
    "fs.apply_patch",
    "service.restart",
    "service.status",
    "service.logs",
    "net.http",
    "submit_flag",
  ].includes(value);
}
