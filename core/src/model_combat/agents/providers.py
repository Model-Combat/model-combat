from __future__ import annotations

from dataclasses import replace

from model_combat.agents.base import AgentLaunchSpec, AgentModelConfig, AgentRunner


class OpenAIRunner(AgentRunner):
    provider_name = "openai"

    def build_launch_spec(self, **kwargs) -> AgentLaunchSpec:
        spec = super().build_launch_spec(**kwargs)
        model = kwargs["model"]
        launch_env = {
            **spec.env,
            "MODEL_PROVIDER": self.provider_name,
            "MODEL_NAME": model.model_name,
        }
        if model.reasoning_effort:
            launch_env["MODEL_REASONING_EFFORT"] = model.reasoning_effort
        if model.env_var_name:
            launch_env["MODEL_API_KEY_ENV"] = model.env_var_name
        return replace(spec, env=launch_env)


class AnthropicRunner(AgentRunner):
    provider_name = "anthropic"

    def build_launch_spec(self, **kwargs) -> AgentLaunchSpec:
        spec = super().build_launch_spec(**kwargs)
        model = kwargs["model"]
        launch_env = {
            **spec.env,
            "MODEL_PROVIDER": self.provider_name,
            "MODEL_NAME": model.model_name,
        }
        if model.reasoning_effort:
            launch_env["MODEL_REASONING_EFFORT"] = model.reasoning_effort
        if model.env_var_name:
            launch_env["MODEL_API_KEY_ENV"] = model.env_var_name
        return replace(spec, env=launch_env)


class OpenCodeRunner(AgentRunner):
    provider_name = "opencode"

    def build_launch_spec(self, **kwargs) -> AgentLaunchSpec:
        spec = super().build_launch_spec(**kwargs)
        model = kwargs["model"]
        launch_env = {
            **spec.env,
            "MODEL_PROVIDER": self.provider_name,
            "MODEL_NAME": model.model_name,
        }
        if model.reasoning_effort:
            launch_env["MODEL_REASONING_EFFORT"] = model.reasoning_effort
        if model.env_var_name:
            launch_env["MODEL_API_KEY_ENV"] = model.env_var_name
        return replace(spec, env=launch_env)
