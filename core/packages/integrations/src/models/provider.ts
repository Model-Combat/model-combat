export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ModelCompletion {
  outputText: string;
  toolCalls: ModelToolCall[];
  rawResponse: unknown;
}

export interface ModelProvider {
  readonly provider: string;
  complete(input: {
    model: string;
    messages: ModelMessage[];
    tools: ModelToolDefinition[];
  }): Promise<ModelCompletion>;
}

export class StubModelProvider implements ModelProvider {
  readonly provider = "stub";

  async complete(input: {
    model: string;
    messages: ModelMessage[];
    tools: ModelToolDefinition[];
  }): Promise<ModelCompletion> {
    return {
      outputText: `stub completion for ${input.model} with ${input.messages.length} messages and ${input.tools.length} tools`,
      toolCalls: [],
      rawResponse: {
        provider: this.provider,
      },
    };
  }
}

export class OpenAiCompatibleModelProvider implements ModelProvider {
  readonly provider = "openai-compatible";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  async complete(input: {
    model: string;
    messages: ModelMessage[];
    tools: ModelToolDefinition[];
  }): Promise<ModelCompletion> {
    const response = await fetch(new URL("/chat/completions", this.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages.map((message) => normalizeOpenAiMessage(message)),
        tools: input.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        tool_choice: input.tools.length > 0 ? "auto" : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`openai-compatible provider failed with ${response.status}`);
    }

    const body = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
          tool_calls?: Array<{
            function?: {
              name?: string;
              arguments?: string;
            };
          }>;
        };
      }>;
    };

    const message = body.choices?.[0]?.message;
    return {
      outputText: normalizeOpenAiContent(message?.content),
      toolCalls: (message?.tool_calls ?? [])
        .map((toolCall) => ({
          toolName: toolCall.function?.name ?? "",
          arguments: parseJsonObject(toolCall.function?.arguments),
        }))
        .filter((toolCall) => Boolean(toolCall.toolName)),
      rawResponse: body,
    };
  }
}

export class AnthropicModelProvider implements ModelProvider {
  readonly provider = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.anthropic.com",
    private readonly anthropicVersion = process.env.ANTHROPIC_VERSION ?? "2023-06-01",
  ) {}

  async complete(input: {
    model: string;
    messages: ModelMessage[];
    tools: ModelToolDefinition[];
  }): Promise<ModelCompletion> {
    const system = input.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");

    const response = await fetch(new URL("/v1/messages", this.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.anthropicVersion,
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS ?? "2048"),
        system,
        messages: input.messages
          .filter((message) => message.role !== "system")
          .map((message) => normalizeAnthropicMessage(message)),
        tools: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`anthropic provider failed with ${response.status}`);
    }

    const body = await response.json() as {
      content?: Array<
        | { type: "text"; text?: string }
        | { type: "tool_use"; name?: string; input?: Record<string, unknown> }
      >;
    };

    const textParts = (body.content ?? [])
      .filter((block): block is { type: "text"; text?: string } => block.type === "text")
      .map((block) => block.text ?? "");
    const toolCalls = (body.content ?? [])
      .filter((block): block is { type: "tool_use"; name?: string; input?: Record<string, unknown> } => block.type === "tool_use")
      .map((block) => ({
        toolName: block.name ?? "",
        arguments: block.input ?? {},
      }))
      .filter((toolCall) => Boolean(toolCall.toolName));

    return {
      outputText: textParts.join("\n"),
      toolCalls,
      rawResponse: body,
    };
  }
}

export function createModelProviderFromEnv(): ModelProvider {
  const kind = process.env.MODEL_PROVIDER_KIND ?? process.env.MODEL_PROVIDER ?? "stub";

  if (kind === "openai-compatible") {
    const baseUrl = process.env.MODEL_API_BASE_URL ?? process.env.OPENAI_BASE_URL;
    const apiKey = process.env.MODEL_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error("MODEL_API_BASE_URL/OPENAI_BASE_URL and MODEL_API_KEY/OPENAI_API_KEY are required for openai-compatible provider");
    }

    return new OpenAiCompatibleModelProvider(baseUrl, apiKey, parseExtraHeaders(process.env.MODEL_API_HEADERS));
  }

  if (kind === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required for anthropic provider");
    }

    return new AnthropicModelProvider(apiKey, process.env.ANTHROPIC_BASE_URL);
  }

  return new StubModelProvider();
}

function normalizeOpenAiMessage(message: ModelMessage): { role: "system" | "user" | "assistant"; content: string } {
  if (message.role === "tool") {
    return {
      role: "user",
      content: `Tool result:\n${message.content}`,
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function normalizeAnthropicMessage(message: ModelMessage): { role: "user" | "assistant"; content: Array<{ type: "text"; text: string }> } {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
    };
  }

  return {
    role: "user",
    content: [{ type: "text", text: message.role === "tool" ? `Tool result:\n${message.content}` : message.content }],
  };
}

function normalizeOpenAiContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  return (content ?? [])
    .map((part) => part.text ?? "")
    .join("\n");
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function parseExtraHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
  } catch {
    return {};
  }
}
