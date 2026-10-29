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

/** The local MCP process of a session and how it reaches Pages. */
export interface CliSessionMcp {
  /** The Node binary that runs the bundle. */
  readonly node: string;
  readonly bundle: string;
  /** The web and API address of Pages, never an MCP network endpoint. */
  readonly url: string;
  /** The credential of the session; it travels in a process environment or input, never in arguments. */
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

/** Keeps Pica's narrower restrictions separate from plan permission modes. */
export function sessionRunOptionError(
  input: AgentPlanSessionInput,
): AgentErrorCode | null {
  const provider = input.agent.connection.provider;
  if (isApiProvider(provider)) return "provider_invalid";
  if (input.chat && provider === "antigravity")
    return "antigravity_pica_unverified";
  if (input.chat && provider === "opencode")
    return input.options.access === "read_only"
      ? null
      : "opencode_chat_mode_required";
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
