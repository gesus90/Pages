import { apiProviderEndpoint } from "@/definition/AgentConnection";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";

/** Whether a plan connection uses OpenCode as a private runtime for its own API catalog. */
export function isOpenCodeApiAgent(
  provider: AgentProviderId,
): provider is "openrouter" | "zai" {
  return provider === "openrouter" || provider === "zai";
}

/** Adds the runtime provider prefix only at the native ACP boundary. */
export function openCodeAgentModel(input: AgentPlanSessionInput): string {
  const { connection, model } = input.agent;
  return isOpenCodeApiAgent(connection.provider)
    ? `${connection.provider}/${model}`
    : model;
}

/** Keeps the saved z.AI account endpoint while using its public native provider ID. */
export function openCodeAgentLaunch(
  input: AgentPlanSessionInput,
  launch: AcpLaunch,
): AcpLaunch {
  if (input.agent.connection.provider !== "zai") return launch;
  const configuration: unknown = JSON.parse(
    launch.environment.OPENCODE_CONFIG_CONTENT,
  );
  if (typeof configuration !== "object" || configuration === null)
    return launch;
  return {
    ...launch,
    environment: {
      ...launch.environment,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        ...configuration,
        provider: {
          zai: {
            options: {
              baseURL: apiProviderEndpoint(
                "zai",
                input.agent.connection.zaiAccountType,
              ),
            },
          },
        },
      }),
    },
  };
}

/** Presents native runtime diagnostics under the connection and model the user selected. */
export function describeOpenCodeAgent(
  input: AgentPlanSessionInput,
  text: string,
): string {
  const provider = input.agent.connection.provider;
  if (!isOpenCodeApiAgent(provider)) return text;
  return text
    .replaceAll(openCodeAgentModel(input), input.agent.model)
    .replaceAll("OpenCode", provider === "openrouter" ? "OpenRouter" : "z.AI");
}
