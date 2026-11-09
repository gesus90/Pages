import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { openCodeModelProvider } from "@/definition/AgentConnection";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpNamespaceOwner } from "@/definition/AcpResource";
import type { NativeAcpProviderId } from "@/definition/AgentConfiguration";
import type { CliStatusOutcome } from "./CliContracts";
import type { CliGitHubAccess } from "./CliGitHubCredentials";

/** Records the namespace of a session with its GitHub access, where both exist. */
export async function recordGitHubNamespace(
  github: CliGitHubAccess | null,
  namespace: AcpNamespaceOwner | undefined,
): Promise<void> {
  if (github && namespace) await github.recordNamespace(namespace);
}

/** Every CLI plan runner and native Pica runner uses ACP, without a one-shot fallback. */
export function sessionAcpProvider(
  input: AgentPlanSessionInput,
): NativeAcpProviderId | null {
  const provider = input.agent.connection.provider;
  return isAcpProvider(provider) ? provider : null;
}

/** Refuses a start whose sign-in or model the status check does not confirm. */
export function validateSessionStatus(
  input: AgentPlanSessionInput,
  status: CliStatusOutcome,
  signal: AbortSignal,
): void {
  const provider = input.agent.connection.provider;
  if (signal.aborted) throw new AgentPlanCancelledError();
  if (!status.outcome.ok)
    throw new AgentError(
      provider === "opencode" ||
        status.outcome.errorCode === "cli_not_logged_in"
        ? status.outcome.errorCode
        : "plan_step_failed",
    );
  if (
    provider === "opencode" &&
    !status.credentials?.modelProviders.includes(
      openCodeModelProvider(input.agent.model),
    )
  )
    throw new AgentError("plan_model_unavailable");
}
