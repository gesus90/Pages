import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";

/** The workspace of every synthetic session input. */
export const SESSION_WORKSPACE = "/synthetic/workspace";

/**
 * Builds the input of a synthetic plan session.
 *
 * @param provider - The runner of the agent's connection.
 * @param options - The run options of the agent.
 * @param overrides - Fields that differ from the synthetic default.
 * @returns A complete session input without credentials of a real account.
 */
export function sessionInput(
  provider: AgentProviderId,
  options: AgentRunOptions,
  overrides: Partial<AgentPlanSessionInput> = {},
): AgentPlanSessionInput {
  return {
    agent: {
      model: provider === "claude_code" ? "claude-sonnet-5-5" : "gpt-synthetic",
      reasoningEffort: "high",
      connection: {
        id: "connection",
        name: "Runner",
        provider,
        isActive: true,
        hasApiKey: false,
        testModel: null,
        reasoningEffort: null,
        cliLoggedInAt: "2026-01-01",
        cliAccountLabel: null,
        updatedAt: "2026-01-01",
      },
    },
    userId: "owner",
    prompt: "Complete synthetic prompt",
    directory: SESSION_WORKSPACE,
    options,
    instanceId: "instance-synthetic",
    mcp: null,
    ...overrides,
  };
}
