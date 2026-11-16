import { AgentError } from "@/backend/error/AgentErrors";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { createNodeRun } from "./AgentPlanNodeRun";
import { planSessionReach } from "./AgentPlanSessionAccess";
import {
  storedPlanIteration,
  storedPlanNodeInput,
} from "./loop/AgentPlanStoredIteration";
import { sessionStart } from "./sessions/AgentSessionAttempts";

import type {
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanStepStart } from "./AgentPlanStepStart";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { NodeRun } from "./AgentPlanStepContext";
import type { AgentPlanSessionTerms } from "./AgentPlanStepAssessment";
import type { AgentPlanGroupSessions } from "./AgentPlanGroupSessions";

interface RunnerSessionDependencies {
  readonly execution: PlanExecution;
  readonly start: Pick<AgentPlanStepStart, "prepare">;
  readonly groups: AgentPlanGroupSessions;
  readonly retained?: Map<string, NodeRun[]>;
  readonly save?: (record: NonNullable<NodeRun["record"]>) => Promise<void>;
  readonly observer: (node: NodeRun) => PlanSessionObserver;
}

type FinishRunnerStep = (
  node: NodeRun,
  session: PlanSession,
  terms: AgentPlanSessionTerms,
) => Promise<Partial<AgentPlanStepResult>>;

/** Reattaches exactly the saved claim; no prompt is resubmitted during recovery. */
export function reattachRunnerStep(
  node: NodeRun,
  dependencies: RunnerSessionDependencies,
  finish: FinishRunnerStep,
): ReturnType<FinishRunnerStep> | null {
  const previous = node.run.steps.find((step) => step.id === node.step.step.id);
  if (
    previous?.status !== "running" ||
    previous.session?.mode === "request" ||
    previous.session?.endedAt !== null ||
    !previous.session.runnerJob
  )
    return null;
  node.record = previous.session;
  node.hasStarted = true;
  return finishAttached(node, dependencies, finish);
}

async function finishAttached(
  node: NodeRun,
  dependencies: RunnerSessionDependencies,
  finish: FinishRunnerStep,
): ReturnType<FinishRunnerStep> {
  const record = node.record;
  if (!record?.contract || !record.requested.options)
    throw new AgentError("plan_context_changed");
  const session = await attach(node, dependencies);
  return finish(node, session, {
    contract: record.contract,
    instruction: node.step.step.instruction,
    reach: planSessionReach(node.step.provider, record.requested.options),
  });
}

async function attach(
  node: NodeRun,
  dependencies: RunnerSessionDependencies,
): Promise<PlanSession> {
  const record = node.record;
  if (
    !record?.runnerJob ||
    !record.requested.options ||
    !record.requested.directory ||
    !dependencies.execution.reattach ||
    !dependencies.execution.restoreAccess
  )
    throw new AgentError("plan_context_changed");
  const prepared = await dependencies.start.prepare(
    node.run,
    node.snapshot,
    node.step,
  );
  const scope = node.sessionGroup ?? node.step.step.id;
  const mcp = await dependencies.execution.restoreAccess(
    record.runnerJob,
    node.run.id,
  );
  const session = await dependencies.execution.reattach(
    {
      ...prepared.input,
      directory: record.requested.directory,
      instanceId: record.instanceId,
      options: record.requested.options,
      mcp,
      recording: sessionStart(node, record.instanceId) ?? undefined,
      resourceContext: {
        planId: node.run.planId,
        runId: node.run.id,
        stepId: node.step.step.id,
        sessionScopeId: scope,
      },
    },
    record.runnerJob,
    node.control.signal,
    dependencies.observer(node),
  );
  if (node.sessionGroup)
    dependencies.groups.restore(`${node.run.id}/${node.sessionGroup}`, {
      record,
      stepId: node.step.step.id,
      userId: node.run.userId,
      mcp,
      session,
      started: null,
      runnerIdentity: prepared.input.runnerTarget
        ? {
            connectionId: prepared.input.runnerTarget.connectionId,
            accountId: prepared.input.runnerCommand?.agentAccount?.id,
          }
        : undefined,
    });
  return session;
}

/** Restores idle shared threads so the next group member or loop iteration keeps its native session. */
export async function restoreRunnerSessions(
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
  dependencies: RunnerSessionDependencies,
): Promise<void> {
  const restored = new Set<string>();
  for (const result of [...allPlanRunResults(run)].reverse()) {
    if (
      !result.session?.runnerJob ||
      result.session.mode === "request" ||
      result.session.endedAt !== null
    )
      continue;
    const source = snapshot.steps.find((step) => step.step.id === result.id);
    if (!source) continue;
    const restoredInput = storedPlanNodeInput(run, source, result);
    const node = createNodeRun(
      restoredInput.run,
      snapshot,
      restoredInput.step,
      {
        signal: new AbortController().signal,
        save: dependencies.save ?? (() => Promise.resolve()),
        iteration: storedPlanIteration(run, result),
      },
    );
    node.record = result.session;
    if (
      node.sessionGroup &&
      result.status === "succeeded" &&
      dependencies.retained
    ) {
      const key = `${run.id}/${node.sessionGroup}`;
      dependencies.retained.set(key, [
        ...(dependencies.retained.get(key) ?? []),
        node,
      ]);
    }
    if (!node.sessionGroup || restored.has(node.sessionGroup)) continue;
    restored.add(node.sessionGroup);
    await attach(node, dependencies);
  }
}
