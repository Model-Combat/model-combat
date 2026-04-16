import type { TraceEvent } from "@model-combat/contracts";

const secretPatterns = [
  /AKIA[0-9A-Z]{16}/g,
  /sk-[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]{10,}/g,
];

export function redactText(input: string): string {
  return secretPatterns.reduce((value, pattern) => value.replaceAll(pattern, "[REDACTED]"), input);
}

export function sanitizeTraceEvent(event: TraceEvent): TraceEvent {
  return {
    ...event,
    attributes: Object.fromEntries(
      Object.entries(event.attributes).map(([key, value]) => {
        if (typeof value === "string") {
          return [key, redactText(value)];
        }

        return [key, value];
      }),
    ),
  };
}

export interface TraceSink {
  write(event: TraceEvent): Promise<void>;
}

export class ConsoleTraceSink implements TraceSink {
  async write(event: TraceEvent): Promise<void> {
    const sanitized = sanitizeTraceEvent(event);
    console.log(JSON.stringify(sanitized));
  }
}

export class JudgeTraceSink implements TraceSink {
  constructor(private readonly judgeUrl: string) {}

  async write(event: TraceEvent): Promise<void> {
    const sanitized = sanitizeTraceEvent(event);
    await fetch(new URL("/internal/traces/batch", this.judgeUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        traces: [sanitized],
      }),
    }).catch(() => undefined);
  }
}

export class CompositeTraceSink implements TraceSink {
  constructor(private readonly sinks: TraceSink[]) {}

  async write(event: TraceEvent): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.write(event)));
  }
}
