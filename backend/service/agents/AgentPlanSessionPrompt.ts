import { AgentError } from "@/backend/error/AgentErrors";
import { isPlanSessionRetryCode } from "@/backend/agents/AgentSessionFailure";
import { PLAN_SESSION_MAXIMUM_ATTEMPTS } from "@/definition/AgentPlanRetry";

import { renderPlanAssignment } from "./AgentPlanContract";
import { planSessionReach } from "./AgentPlanSessionAccess";
import { runnerLabel } from "./AgentPlanSessionRecords";
import { planRecoveryTerms } from "./recovery/AgentPlanRecoveryPrompt";
import { planTurnScope } from "./loop/AgentPlanLoopSession";
import type { GroupSessionResume } from "./AgentPlanGroupSessions";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanContract } from "@/definition/AgentPlanSession";
import type { NodeRun } from "./AgentPlanStepContext";
import type { PreparedPlanStep } from "./AgentPlanStepStart";

interface PromptTerms {
  readonly contract: AgentPlanContract;
  readonly mcp: AgentPlanSessionInput["mcp"];
  readonly instanceId: string;
}

interface PromptDependencies {
  readonly pin: (prompt: string) => Promise<void>;
  readonly journal: (instanceId: string) => AgentPlanSessionInput["journal"];
}

/**
 * Tells the agent why a fresh attempt follows a technical session error.
 *
 * @remarks
 * A native resume keeps the earlier conversation. A new session is marked as
 * such and must reconcile the working state before repeating an action.
 */
function retryNotice(node: NodeRun, resumeSessionId: string | null): string {
  const retry = node.retry;
  if (!retry || retry.state !== "running" || retry.attempts.length === 0)
    return "";
  const policy =
    retry.policy ??
    (retry.attempts.some((attempt) => isPlanSessionRetryCode(attempt.code))
      ? "session"
      : "provider");
  if (policy !== "session") return "";
  const failedAttempt = node.retryAttemptNumber - 1;
  const mode =
    resumeSessionId === null
      ? "starts a new native session and does not remember the earlier conversation"
      : "continues the earlier native session";
  return [
    "## Pages automatic session retry",
    "",
    `A technical session error ended attempt ${failedAttempt} of ${PLAN_SESSION_MAXIMUM_ATTEMPTS}. This attempt ${mode}. Files and other external effects of the earlier attempt may already exist. Inspect the current state first, keep correct results, and do not repeat a completed external action.`,
    "",
    "",
  ].join("\n");
}

/** Builds the exact session input, including the recovery and retry notices. */
export async function buildPlanSessionInput(
  node: NodeRun,
  prepared: PreparedPlanStep,
  terms: PromptTerms,
  dependencies: PromptDependencies,
): Promise<AgentPlanSessionInput> {
  const directory = prepared.input.directory;
  if (directory === null) throw new AgentError("plan_directory_required");
  const recovery = planRecoveryTerms(node.snapshot, node.step.step.id, node);
  const resumeSessionId = recovery.resumeSessionId ?? node.retryResumeSessionId;
  const scope = `${retryNotice(node, resumeSessionId)}${recovery.note}${planTurnScope(node.step, node.loop)}`;
  const prompt = `${scope}${prepared.input.prompt}\n\n${renderPlanAssignment({
    contract: terms.contract,
    usesMcp: terms.mcp !== null,
    isReadOnly:
      planSessionReach(
        prepared.input.agent.connection.provider,
        prepared.options,
      ) === "read",
    runnerLabel: node.record ? runnerLabel(node.record) : "",
    instanceId: terms.instanceId,
    directory,
    requiresAcceptance: true,
    acceptanceScope: node.step.groupId ? "group" : "node",
  })}`;
  await dependencies.pin(prompt);
  return {
    ...prepared.input,
    prompt,
    directory,
    options: prepared.options,
    instanceId: terms.instanceId,
    mcp: terms.mcp,
    resumeSessionId,
    resourceContext: { runId: node.run.id, stepId: node.step.step.id },
    journal: dependencies.journal(terms.instanceId),
  };
}

/** The shared session position a session retry continues, or `undefined` outside one. */
export function planRetryGroupResume(
  node: NodeRun,
): GroupSessionResume | undefined {
  if (!node.sessionGroup || !node.retryResumeSessionId || !node.retryGroup)
    return undefined;
  return {
    sessionId: node.retryResumeSessionId,
    creatorStepId: node.retryGroup.creatorStepId,
    turns: node.retryGroup.turn,
  };
}
