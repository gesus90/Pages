import { readAgentObject } from "@/backend/agents/AgentPayload";
import {
  readAgentConfiguration,
  readAgentTargets,
} from "@/backend/agents/AgentConfigurationInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { requireCredentialFreeText } from "@/backend/service/assistant/TextAssistantValidation";
import { isAgentProfilePurpose } from "@/definition/AgentProfile";
import { agentParameterIssues } from "@/definition/AgentParameters";
import { isAgentRunOptionsAllowed } from "@/definition/AgentConfiguration";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  AgentProfileInput,
  AgentProfilePurpose,
  AgentProfileTarget,
} from "@/definition/AgentProfile";
import type {
  AgentConfiguration,
  AgentRunOptions,
} from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";

function readText(input: unknown, maximum: number): string {
  if (typeof input !== "string" || !input.trim() || input.length > maximum)
    throw new AgentError("profile_invalid");
  requireCredentialFreeText(input);
  return input.trim();
}

/** Narrows complete profile configuration before persistence or authorization checks. */
export function readAgentProfileInput(input: unknown): AgentProfileInput {
  const profile = readAgentObject(input);
  if (typeof profile.isActive !== "boolean")
    throw new AgentError("profile_invalid");
  const purposes = readPurposes(profile.purposes);
  const targets = readAgentTargets(profile.targets);
  if (new Set(targets.map((target) => target.kind)).size > 1)
    throw new AgentError("profile_scope_invalid");
  const configuration =
    profile.configuration === undefined
      ? undefined
      : readAgentConfiguration(profile.configuration);
  if (configuration)
    requireConfiguration(configuration, targets, profile.isActive);
  const revision = readRevision(profile.revision);
  if (
    targets.some(
      (target) =>
        target.kind === "system" &&
        !purposes.some((purpose) => purpose === target.targetId),
    )
  )
    throw new AgentError("profile_invalid");
  return {
    name: readText(profile.name, 80),
    connectionId: readText(profile.connectionId, 100),
    model: readText(profile.model, 200),
    reasoningEffort:
      profile.reasoningEffort === null
        ? null
        : readText(profile.reasoningEffort, 24),
    isActive: profile.isActive,
    ...(configuration ? { configuration } : {}),
    ...(revision === undefined ? {} : { revision }),
    purposes,
    targets,
  };
}

function readPurposes(input: unknown): AgentProfilePurpose[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 3)
    throw new AgentError("profile_invalid");
  const purposes = input.map((purpose: unknown) => {
    if (!isAgentProfilePurpose(purpose))
      throw new AgentError("profile_invalid");
    return purpose;
  });
  return [...new Set(purposes)];
}

function readRevision(input: unknown): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 1)
    throw new AgentError("profile_invalid");
  return input;
}

function requireConfiguration(
  configuration: AgentConfiguration,
  targets: readonly AgentProfileTarget[],
  isActive: boolean,
): void {
  if (
    targets.some((target) => target.kind !== configuration.scope) ||
    (configuration.accessMode === "personal") !==
      (configuration.scope === "person") ||
    (isActive && configuration.scope !== "system" && targets.length === 0)
  )
    throw new AgentError("profile_scope_invalid");
  if (isActive && agentParameterIssues(configuration).length > 0)
    throw new AgentError("parameter_invalid");
}

function permissionModeRefusal(provider: AgentProviderId): AgentErrorCode {
  if (provider === "codex_cli") return "codex_permission_mode_required";
  if (provider === "claude_code") return "claude_permission_mode_required";
  return "plan_run_option_unsupported";
}

/**
 * Refuses run options the agent's runner does not offer.
 *
 * @param provider - The provider of the agent's model connection.
 * @param run - The run options to store.
 * @param previous - The run options stored so far; absent for a new agent.
 * @throws {AgentError} `codex_permission_mode_required` or
 * `claude_permission_mode_required` when an ACP agent would store the earlier
 * write mode anew, `plan_run_option_unsupported` for YOLO outside the ACP
 * runners.
 */
export function requireAllowedRunOptions(
  provider: AgentProviderId,
  run: AgentRunOptions | undefined,
  previous: AgentRunOptions | undefined,
): void {
  if (isAgentRunOptionsAllowed(provider, run, previous)) return;
  throw new AgentError(permissionModeRefusal(provider));
}
