import { AgentError } from "@/backend/error/AgentErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { acpDriverFor } from "@/backend/agents/acp/AcpDrivers";
import { isAcpPermissionMode } from "@/definition/AgentConfiguration";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  AcpPermissionMode,
  AgentRunOptions,
} from "@/definition/AgentConfiguration";
import type { CliProviderId } from "@/definition/AgentConnection";

/** The step-bound Pages tool access of a session and how it reaches Pages. */
export interface CliSessionMcp {
  /** The web and API address of this Pages instance; the plan bridge lies below it. */
  readonly url: string;
  /** The credential of the step; it travels in the `session/new` input, never in arguments or a process environment. */
  readonly token: string;
  /**
   * The MCP tool names the session may call; `null` offers every tool the
   * Pages server grants the credential, without a list of the runner.
   */
  readonly tools: readonly string[] | null;
}

/**
 * Names a run option the runner cannot enforce, so the node is refused before it starts.
 *
 * @param provider - The runner of the connection.
 * @param options - The run options of the agent, resolved for its provider.
 * @returns The refusal, or `null` when the runner enforces every option.
 *
 * @remarks
 * Every CLI plan agent runs only in "Nur Lesen" or YOLO. An earlier write
 * mode is never raised to YOLO on its own; it blocks until a mode is chosen.
 */
export function unsupportedRunOption(
  provider: CliProviderId,
  options: AgentRunOptions,
): AgentErrorCode | null {
  return isAcpPermissionMode(options.access)
    ? null
    : acpDriverFor(provider).errors.modeRequired;
}

/**
 * Names a run option a session cannot start with.
 *
 * @param input - The session to start, a plan node or a conversation.
 * @returns The refusal, or `null` when the runner enforces every option.
 *
 * @remarks
 * A conversation runs in both modes like a plan node: Pica's own runners pass
 * only "Nur Lesen", and only an agent employee with full access reaches a
 * conversation in YOLO, with the chat profile of its runner.
 */
export function sessionRunOptionError(
  input: AgentPlanSessionInput,
): AgentErrorCode | null {
  const provider = input.agent.connection.provider;
  if (isApiProvider(provider)) return "provider_invalid";
  return unsupportedRunOption(provider, input.options);
}

/** OpenCode, YOLO and Pica's conversations start only inside the namespace. */
export function requireAcpIsolation(
  isIsolated: boolean,
  mode: AcpPermissionMode,
  input: AgentPlanSessionInput,
): void {
  if (isIsolated) return;
  if (
    input.chat ||
    ["opencode", "antigravity"].includes(input.agent.connection.provider)
  )
    throw new AgentError("cli_isolation_unavailable");
  if (mode === "yolo") throw new AgentError("plan_yolo_isolation_unavailable");
}
