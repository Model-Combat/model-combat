#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
from typing import Any

from model_combat.agents.clients import (
    AnthropicProviderClient,
    OpenAIProviderClient,
    OpenCodeProviderClient,
    ProviderClient,
    resolve_api_key_details,
)
from model_combat.config import get_settings
from model_combat.redaction import redact_secrets


def _check_provider(
    *,
    provider: str,
    client: ProviderClient,
    api_key_env_var: str,
) -> dict[str, Any]:
    key_details = resolve_api_key_details(api_key_env_var)
    result: dict[str, Any] = {
        "provider": provider,
        "model": client.model_name,
        "reasoning_effort": client.reasoning_effort,
        "api_key_env_var": api_key_env_var,
        "api_key_present": bool(key_details["value"]),
        "api_key_source": key_details["source"],
        "environment_key_present": key_details["environment_present"],
        "dotenv_key_present": key_details["dotenv_present"],
        "prefer_dotenv": key_details["prefer_dotenv"],
        "environment_overrides_dotenv": key_details["environment_overrides_dotenv"],
        "ok": False,
    }
    if not result["api_key_present"]:
        result["error_type"] = "missing_api_key"
        result["error"] = f"{api_key_env_var} is not set"
        return result

    try:
        client.start("Reply with exactly: OK")
        turn = client.step()
    except Exception as exc:
        result["error_type"] = type(exc).__name__
        result["error"] = redact_secrets(str(exc))
        return result

    result["ok"] = True
    result["finish_reason"] = turn.finish_reason
    result["text"] = turn.text[:500]
    result["tool_call_count"] = len(turn.tool_calls)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Preflight configured provider access.")
    parser.add_argument(
        "--provider",
        choices=("all", "openai", "anthropic", "opencode"),
        default="all",
        help="Provider to check.",
    )
    args = parser.parse_args()

    settings = get_settings()
    checks: list[dict[str, Any]] = []

    if args.provider in {"all", "openai"}:
        checks.append(
            _check_provider(
                provider="openai",
                api_key_env_var=settings.openai_api_key_env,
                client=OpenAIProviderClient(
                    model_name=settings.openai_model_name,
                    reasoning_effort=settings.openai_reasoning_effort,
                    tools=[],
                    system="You are a connectivity preflight for Model Combat. Reply with exactly: OK",
                    api_key_env_var=settings.openai_api_key_env,
                ),
            )
        )

    if args.provider in {"all", "anthropic"}:
        checks.append(
            _check_provider(
                provider="anthropic",
                api_key_env_var=settings.anthropic_api_key_env,
                client=AnthropicProviderClient(
                    model_name=settings.anthropic_model_name,
                    reasoning_effort=settings.anthropic_reasoning_effort,
                    tools=[],
                    system="You are a connectivity preflight for Model Combat. Reply with exactly: OK",
                    api_key_env_var=settings.anthropic_api_key_env,
                ),
            )
        )

    if args.provider in {"all", "opencode"}:
        # Opt-in: only run the OpenCode preflight if the key is actually set.
        if resolve_api_key_details(settings.opencode_api_key_env)["value"] or args.provider == "opencode":
            checks.append(
                _check_provider(
                    provider="opencode",
                    api_key_env_var=settings.opencode_api_key_env,
                    client=OpenCodeProviderClient(
                        base_url=settings.opencode_base_url,
                        model_name=settings.opencode_model_name,
                        reasoning_effort=settings.opencode_reasoning_effort,
                        tools=[],
                        system="You are a connectivity preflight for Model Combat. Reply with exactly: OK",
                        api_key_env_var=settings.opencode_api_key_env,
                    ),
                )
            )

    print(json.dumps({"ok": all(check["ok"] for check in checks), "checks": checks}, indent=2))
    return 0 if all(check["ok"] for check in checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
