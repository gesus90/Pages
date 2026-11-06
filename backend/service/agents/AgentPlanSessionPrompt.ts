import { AgentError } from "@/backend/error/AgentErrors";

import { renderPlanAssignment } from "./AgentPlanContract";
import { planRetryNotice } from "./AgentPlanRetryNotice";
import { planSessionReach } from "./AgentPlanSessionAccess";
import { runnerLabel } from "./AgentPlanSessionRecords";
import { planRecoveryTerms } from "./recovery/AgentPlanRecoveryPrompt";
import { planTurnScope } from "./loop/AgentPlanLoopSession";
import { sessionStart } from "./sessions/AgentSessionAttempts";

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

/** The notice of a running retry; a first attempt has none. */
function retryNotice(node: NodeRun, resumeSessionId: string | null): string {
  const retry = node.retry;
  if (retry?.state !== "running") return "";
  return planRetryNotice(retry, resumeSessionId !== null);
}

const EVENT_FOLLOW_UP =
  "This is a follow-up turn of your open session, started by the plan. Your main instruction (AGENT.md) and the inputs of your first turn stay valid and are not repeated. Only the new information below is new: work on it and close with the report requested below.\n\n";

const EVENT_NEW_SESSION =
  "This is a NEW session. The earlier session of this node is no longer open, so its conversation is not available to you. Your main instruction and inputs follow in full, together with the new information that caused this start.\n\n";

/**
 * The part of the prompt that is specific to the start: the node's own instruction, or what an event brings.
 *
 * @remarks
 * A follow-up in the open session carries the new information only. A start
 * in a replacement session carries the full instruction and the new
 * information, and says that it is a new session.
 */
function startBody(node: NodeRun, prepared: PreparedPlanStep): string {
  const event = node.event;
  if (event === null || node.eventMode === null) return prepared.input.prompt;
  if (node.eventMode === "continued")
    return `${EVENT_FOLLOW_UP}${event.prompt}`;
  return `${EVENT_NEW_SESSION}${prepared.input.prompt}\n\n## New information that caused this start\n\n${event.prompt}`;
}

/** The prompt of a request to an API provider, which has no session that could remember anything. */
export function planRequestPrompt(
  node: NodeRun,
  prepared: PreparedPlanStep,
): string {
  const recovery = planRecoveryTerms(node.snapshot, node.step.step.id, node);
  return `${retryNotice(node, null)}${recovery.note}${prepared.input.prompt}`;
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
  const prompt = `${scope}${startBody(node, prepared)}\n\n${renderPlanAssignment(
    {
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
      hasProjectGitHub: prepared.input.github !== undefined,
    },
  )}`;
  await dependencies.pin(prompt);
  return {
    ...prepared.input,
    prompt,
    directory,
    options: prepared.options,
    instanceId: terms.instanceId,
    recording: sessionStart(node, terms.instanceId) ?? undefined,
    acceptanceInstruction: prepared.instruction ?? node.step.step.instruction,
    mcp: terms.mcp,
    resumeSessionId,
    resourceContext: {
      runId: node.run.id,
      stepId: node.step.step.id,
      sessionScopeId: node.sessionGroup ?? node.step.step.id,
      ...(node.run.origin?.mode === "native_resume"
        ? { sourceRunId: node.run.origin.runId }
        : {}),
    },
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
