from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from model_combat.redaction import redact_secrets


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class ToolCall:
    call_id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    content: str


@dataclass
class AssistantTurn:
    text: str
    tool_calls: list[ToolCall]
    finish_reason: str
    reasoning: str = ""


def _post_json(
    url: str,
    *,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout: int = 180,
    retries: int = 2,
    retry_delay_seconds: float = 1.0,
) -> dict[str, Any]:
    """POST JSON with a hard request-level deadline.

    httpx's timeout covers connect + write + read + pool, so CDN keepalives
    that prevent socket-idle timeouts can't keep us hanging forever the way
    urlopen does.
    """
    body = json.dumps(payload).encode()
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with httpx.Client(timeout=httpx.Timeout(timeout)) as client:
                response = client.post(url, content=body, headers=headers)
            if response.status_code >= 400:
                error_body = response.text
                if response.status_code < 500 or attempt == retries - 1:
                    raise RuntimeError(
                        redact_secrets(
                            f"HTTP {response.status_code} {response.reason_phrase}: {error_body[:500]}"
                        )
                    )
                last_error = RuntimeError(f"HTTP {response.status_code}: {error_body[:200]}")
            else:
                return response.json()
        except httpx.TimeoutException as exc:
            raise RuntimeError(f"upstream timeout after {timeout}s") from exc
        except httpx.HTTPError as exc:
            if attempt == retries - 1:
                raise RuntimeError(redact_secrets(f"network error: {exc}")) from exc
            last_error = exc
        time.sleep(retry_delay_seconds * (attempt + 1))
    if last_error is not None:
        raise RuntimeError(redact_secrets(f"network error: {last_error}")) from last_error
    raise RuntimeError("request failed without an error")


def resolve_api_key(env_var_name: str) -> str | None:
    details = resolve_api_key_details(env_var_name)
    return details["value"]


def resolve_api_key_details(env_var_name: str) -> dict[str, Any]:
    env_value = os.environ.get(env_var_name)
    dotenv_value = _dotenv_value(env_var_name)
    prefer_dotenv = _truthy(os.environ.get("MODEL_COMBAT_PREFER_DOTENV_API_KEYS"))
    if prefer_dotenv and dotenv_value:
        value = dotenv_value
        source = ".env"
    elif env_value:
        value = env_value
        source = "environment"
    elif dotenv_value:
        value = dotenv_value
        source = ".env"
    else:
        value = None
        source = None
    return {
        "value": value,
        "source": source,
        "environment_present": bool(env_value),
        "dotenv_present": bool(dotenv_value),
        "prefer_dotenv": prefer_dotenv,
        "environment_overrides_dotenv": bool(env_value and dotenv_value and env_value != dotenv_value),
    }


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _find_dotenv() -> Path | None:
    """Walk up from cwd looking for a .env. Lets the harness work
    whether the user keeps .env at the project root (./.env) or one
    level up at the monorepo root (../.env)."""
    current = Path.cwd().resolve()
    for parent in (current, *current.parents):
        candidate = parent / ".env"
        if candidate.is_file():
            return candidate
        # Stop walking once we hit a filesystem boundary or 5 levels up
        if parent == parent.parent:
            break
    return None


def _dotenv_value(env_var_name: str) -> str | None:
    env_path = _find_dotenv()
    if env_path is None:
        return None
    try:
        lines = env_path.read_text().splitlines()
    except OSError:
        return None
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key.removeprefix("export ").strip()
        if key != env_var_name:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        return value or None
    return None


class ProviderClient:
    provider_name: str = "unknown"

    def __init__(
        self,
        *,
        model_name: str,
        reasoning_effort: str | None,
        tools: list[ToolSpec],
        system: str,
        api_key_env_var: str | None = None,
    ) -> None:
        self.model_name = model_name
        self.reasoning_effort = reasoning_effort
        self.tools = tools
        self.system = system
        self.api_key_env_var = api_key_env_var

    def start(self, initial_user_message: str) -> None:
        raise NotImplementedError

    def step(self) -> AssistantTurn:
        raise NotImplementedError

    def add_tool_results(self, results: list[ToolResult]) -> None:
        raise NotImplementedError


def _budget_for_effort(effort: str | None) -> int:
    return {"minimal": 2_048, "low": 4_096, "medium": 8_192, "high": 16_384, "xhigh": 24_576}.get((effort or "").lower(), 0)


def _anthropic_supports_adaptive_thinking(model_name: str) -> bool:
    """Claude 4.5+ models use the new adaptive-thinking schema. Older models
    accept the legacy `thinking.type=enabled` shape but silently return no
    thinking blocks if we use it on a model that expects adaptive."""
    normalized = model_name.lower()
    if "claude-mythos" in normalized:
        return True
    # claude-{opus,sonnet,haiku}-4-{5,6,7,…}
    return any(
        token in normalized
        for token in (
            "claude-opus-4-5",
            "claude-opus-4-6",
            "claude-opus-4-7",
            "claude-sonnet-4-5",
            "claude-sonnet-4-6",
            "claude-haiku-4-5",
        )
    )


class AnthropicProviderClient(ProviderClient):
    provider_name = "anthropic"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._messages: list[dict[str, Any]] = []

    def start(self, initial_user_message: str) -> None:
        self._messages = [{"role": "user", "content": [{"type": "text", "text": initial_user_message}]}]

    def step(self) -> AssistantTurn:
        api_key_env_var = self.api_key_env_var or "ANTHROPIC_API_KEY"
        api_key = resolve_api_key(api_key_env_var)
        if not api_key:
            raise RuntimeError(f"{api_key_env_var} is required")

        adaptive = _anthropic_supports_adaptive_thinking(self.model_name)
        thinking_budget = _budget_for_effort(self.reasoning_effort)
        # max_tokens is the TOTAL output budget (thinking + text + tool_use).
        # If we under-budget it, the model spends all of it on tool_use and
        # skips emitting thinking blocks even when the schema asks for them.
        if adaptive:
            max_tokens = max(8192, _budget_for_effort(self.reasoning_effort) + 4096)
        else:
            max_tokens = max(4096, thinking_budget + 2048)
        payload: dict[str, Any] = {
            "model": self.model_name,
            "max_tokens": max_tokens,
            "system": self.system,
            "messages": self._messages,
        }
        if self.tools:
            payload["tools"] = [
                {"name": t.name, "description": t.description, "input_schema": t.parameters}
                for t in self.tools
            ]
        if adaptive:
            payload["thinking"] = {"type": "adaptive"}
            if self.reasoning_effort:
                payload["output_config"] = {"effort": self.reasoning_effort}
        elif thinking_budget:
            payload["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}

        body = _post_json(
            "https://api.anthropic.com/v1/messages",
            payload=payload,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            timeout=180,
        )
        content_blocks: list[dict[str, Any]] = body.get("content", [])
        self._messages.append({"role": "assistant", "content": content_blocks})

        text_parts: list[str] = []
        reasoning_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in content_blocks:
            block_type = block.get("type")
            if block_type == "text":
                text_parts.append(block.get("text", ""))
            elif block_type == "thinking":
                reasoning_parts.append(block.get("thinking", ""))
            elif block_type == "redacted_thinking":
                reasoning_parts.append("[redacted thinking]")
            elif block_type == "tool_use":
                tool_calls.append(
                    ToolCall(
                        call_id=str(block["id"]),
                        name=str(block["name"]),
                        arguments=dict(block.get("input", {})),
                    )
                )
        return AssistantTurn(
            text="\n".join(t for t in text_parts if t),
            tool_calls=tool_calls,
            finish_reason=str(body.get("stop_reason", "")),
            reasoning="\n".join(r for r in reasoning_parts if r),
        )

    def add_tool_results(self, results: list[ToolResult]) -> None:
        content = [
            {"type": "tool_result", "tool_use_id": r.call_id, "content": r.content}
            for r in results
        ]
        self._messages.append({"role": "user", "content": content})


class OpenAIProviderClient(ProviderClient):
    provider_name = "openai"

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._input: list[dict[str, Any]] = []

    def start(self, initial_user_message: str) -> None:
        self._input = [{"role": "user", "content": initial_user_message}]

    def step(self) -> AssistantTurn:
        api_key_env_var = self.api_key_env_var or "OPENAI_API_KEY"
        api_key = resolve_api_key(api_key_env_var)
        if not api_key:
            raise RuntimeError(f"{api_key_env_var} is required")

        payload: dict[str, Any] = {
            "model": self.model_name,
            "instructions": self.system,
            "input": self._input,
        }
        if self.tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                }
                for t in self.tools
            ]
        if self.reasoning_effort:
            payload["reasoning"] = {"effort": self.reasoning_effort}

        body = _post_json(
            "https://api.openai.com/v1/responses",
            payload=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=180,
        )
        output_items: list[dict[str, Any]] = body.get("output", [])
        for item in output_items:
            self._input.append(item)

        text_parts: list[str] = []
        reasoning_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for item in output_items:
            item_type = item.get("type")
            if item_type == "message":
                for content in item.get("content", []):
                    if content.get("type") in {"output_text", "text"} and content.get("text"):
                        text_parts.append(str(content["text"]))
            elif item_type == "reasoning":
                for summary in item.get("summary", []) or []:
                    if isinstance(summary, dict) and summary.get("text"):
                        reasoning_parts.append(str(summary["text"]))
                content = item.get("content")
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") in {"reasoning_text", "text"} and c.get("text"):
                            reasoning_parts.append(str(c["text"]))
            elif item_type == "function_call":
                arguments_str = item.get("arguments") or "{}"
                try:
                    arguments = json.loads(arguments_str)
                except json.JSONDecodeError:
                    arguments = {"_raw": arguments_str}
                tool_calls.append(
                    ToolCall(
                        call_id=str(item.get("call_id") or item.get("id")),
                        name=str(item.get("name", "")),
                        arguments=arguments,
                    )
                )
        return AssistantTurn(
            text="\n".join(text_parts),
            tool_calls=tool_calls,
            finish_reason=str(body.get("status", "")),
            reasoning="\n".join(r for r in reasoning_parts if r),
        )

    def add_tool_results(self, results: list[ToolResult]) -> None:
        for r in results:
            self._input.append(
                {"type": "function_call_output", "call_id": r.call_id, "output": r.content}
            )


class OpenAICompatibleProviderClient(ProviderClient):
    """Generic OpenAI-compatible /v1/chat/completions client.

    Used for gateways like OpenCode Zen, Together, Groq, Anyscale, vLLM —
    anything that speaks the chat-completions schema with tool_calls. Pass
    `base_url` (no trailing /v1) and the right API-key env var.
    """

    provider_name = "openai_compatible"

    def __init__(self, *, base_url: str = "https://api.openai.com/v1", **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.base_url = base_url.rstrip("/")
        self._messages: list[dict[str, Any]] = []

    def start(self, initial_user_message: str) -> None:
        self._messages = [
            {"role": "system", "content": self.system},
            {"role": "user", "content": initial_user_message},
        ]

    def step(self) -> AssistantTurn:
        api_key_env_var = self.api_key_env_var or "OPENAI_API_KEY"
        api_key = resolve_api_key(api_key_env_var)
        if not api_key:
            raise RuntimeError(f"{api_key_env_var} is required")

        payload: dict[str, Any] = {
            "model": self.model_name,
            "messages": self._messages,
        }
        if self.tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                }
                for t in self.tools
            ]
            payload["parallel_tool_calls"] = True
        # Several open-source models exposed via gateways accept this even
        # though it's not part of the legacy chat/completions spec — gateways
        # like OpenCode pass it through to providers that support it and
        # ignore it otherwise. Safe to always include when set.
        if self.reasoning_effort:
            payload["reasoning_effort"] = self.reasoning_effort

        body = _post_json(
            f"{self.base_url}/chat/completions",
            payload=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=180,
        )
        choices = body.get("choices") or []
        if not choices:
            raise RuntimeError(f"empty response from {self.base_url}/chat/completions")
        message = choices[0].get("message") or {}
        self._messages.append(message)

        text = str(message.get("content") or "")
        # Reasoning may show up as `reasoning_content` (DeepSeek, GLM, Qwen)
        # or `reasoning` (some gateways). Capture either.
        reasoning = str(message.get("reasoning_content") or message.get("reasoning") or "")
        tool_calls: list[ToolCall] = []
        for raw in message.get("tool_calls") or []:
            fn = raw.get("function") or {}
            args_str = fn.get("arguments") or "{}"
            try:
                args = json.loads(args_str)
            except json.JSONDecodeError:
                args = {"_raw": args_str}
            tool_calls.append(
                ToolCall(
                    call_id=str(raw.get("id") or fn.get("name", "")),
                    name=str(fn.get("name", "")),
                    arguments=args,
                )
            )
        return AssistantTurn(
            text=text,
            tool_calls=tool_calls,
            finish_reason=str(choices[0].get("finish_reason", "")),
            reasoning=reasoning,
        )

    def add_tool_results(self, results: list[ToolResult]) -> None:
        for r in results:
            self._messages.append(
                {"role": "tool", "tool_call_id": r.call_id, "content": r.content}
            )


class OpenCodeProviderClient(OpenAICompatibleProviderClient):
    """OpenCode Zen gateway client. OpenAI-compatible chat completions over
    a single key that fans out to many models (Kimi, GLM, Qwen, Llama, etc.).
    Override the base URL with MODEL_COMBAT_OPENCODE_BASE_URL if needed.
    """

    provider_name = "opencode"
