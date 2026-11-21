import { AgentError } from "@/backend/error/AgentErrors";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { acpDriverFor } from "@/backend/agents/acp/AcpDrivers";
import { storedAgentAccessMode } from "@/definition/AgentAccessMode";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  AcpPermissionMode,
  AcpProviderId,
  AgentRunOptions,
} from "@/definition/AgentConfiguration";

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
 * @param provider - The runner of the connection.
 * @param options - The run options of the agent, resolved for its provider.
 * @returns The refusal, or `null` when the runner enforces every option.
 * @remarks
 * Every CLI agent runs only in "Lesend" or YOLO, the API connections that
 * OpenCode runs included. An earlier write mode is never raised to YOLO on its
 * own; it blocks until a mode is chosen.
 */
export function unsupportedRunOption(
  provider: AcpProviderId,
  options: AgentRunOptions,
): AgentErrorCode | null {
  return storedAgentAccessMode(options.access) === null
    ? acpDriverFor(provider).errors.modeRequired
    : null;
}

/**
 * Names a run option a session cannot start with.
 * @param input - The session to start, a plan node or a conversation.
 * @returns The refusal, or `null` when the runner enforces every option.
 * @remarks
 * A conversation runs in both modes like a plan node: Pica's own runners pass
 * only "Lesend", and an agent employee in YOLO reaches a conversation in YOLO,
 * with the same native start as a plan node.
 */
export function sessionRunOptionError(
  input: AgentPlanSessionInput,
): AgentErrorCode | null {
  const provider = input.agent.connection.provider;
  if (!isAcpProvider(provider)) return "provider_invalid";
  return unsupportedRunOption(provider, input.options);
}

/**
 * Refuses a "Lesend" session that cannot be held to reading.
 * @remarks
 * Codex and Claude Code enforce their read-only profile themselves, so a
 * plan node of theirs also starts where the read-only namespace does not
 * work. OpenCode, Antigravity and Pica's conversations rely on the namespace
 * to keep the host read-only, so they never start without it as "Lesend";
 * the session is refused with the missing capability instead of starting
 * with wider rights. YOLO never needs the namespace.
 */
export function requireAcpIsolation(
  isIsolated: boolean,
  mode: AcpPermissionMode,
  input: AgentPlanSessionInput,
): void {
  if (isIsolated || mode === "yolo") return;
  if (
    input.chat ||
    ["opencode", "openrouter", "antigravity"].includes(
      input.agent.connection.provider,
    )
  )
    throw new AgentError("cli_isolation_unavailable");
}
