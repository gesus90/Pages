import type {
  AgentPlanSessionInput,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentProviderId } from "@/definition/AgentConnection";

/** Whether a plan connection uses OpenCode as a private runtime for its own API catalog. */
export function isOpenCodeApiAgent(
  provider: AgentProviderId,
): provider is "openrouter" {
  return provider === "openrouter";
}

/** Adds the runtime provider prefix only at the native ACP boundary. */
export function openCodeAgentModel(input: AgentPlanSessionInput): string {
  const { connection, model } = input.agent;
  return isOpenCodeApiAgent(connection.provider)
    ? `${connection.provider}/${model}`
    : model;
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
    .replaceAll("OpenCode", "OpenRouter");
}

/** Rewrites reported ACP capabilities so OpenRouter keeps its public adapter label. */
export function openCodeAgentObserver(
  input: AgentPlanSessionInput,
  observer: PlanSessionObserver,
): PlanSessionObserver {
  if (!isOpenCodeApiAgent(input.agent.connection.provider)) return observer;
  return {
    ...observer,
    capabilities: (capabilities) =>
      observer.capabilities?.({
        ...capabilities,
        adapter: describeOpenCodeAgent(input, capabilities.adapter),
      }),
  };
}
