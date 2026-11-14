import { restoredLocalMcp } from "@/backend/agents/local/LocalSessionContracts";
import { AgentError } from "@/backend/error/AgentErrors";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { createNodeRun } from "./AgentPlanNodeRun";
import { planSessionReach } from "./AgentPlanSessionAccess";
import { sessionStart } from "./sessions/AgentSessionAttempts";
import { JOURNAL_ONLY } from "./AgentPlanGroupInstructions";
import {
  storedPlanIteration,
  storedPlanNodeInput,
} from "./loop/AgentPlanStoredIteration";

import type { LocalSessions } from "@/backend/agents/local/LocalSessions";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentPlanSessionInput,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { AgentPlanStepStart } from "./AgentPlanStepStart";
import type { AgentPlanGroupSessions } from "./AgentPlanGroupSessions";
import type { NodeRun } from "./AgentPlanStepContext";
import type { AgentPlanSessionTerms } from "./AgentPlanStepAssessment";
import type { PlanSession } from "@/backend/agents/AgentPlanExecution";

interface ReattachDependencies {
  readonly local?: LocalSessions;
  readonly observer: (node: NodeRun) => PlanSessionObserver;
  readonly finish: (
    node: NodeRun,
    session: PlanSession,
    terms: AgentPlanSessionTerms,
  ) => Promise<Partial<AgentPlanStepResult>>;
}

/** Continues an already dispatched attempt without preparation of a replacement native session. */
export function reattachLocalStep(
  node: NodeRun,
  dependencies: ReattachDependencies,
): Promise<Partial<AgentPlanStepResult>> | null {
  const previous = node.run.steps.find(
    (result) => result.id === node.step.step.id,
  );
  const record = previous?.session;
  if (
    previous?.status !== "running" ||
    !record ||
    !dependencies.local?.has(record.instanceId)
  )
    return null;
  node.record = record;
  node.hasStarted = record.startedAt !== null;
  return finishReattached(node, dependencies);
}

async function finishReattached(
  node: NodeRun,
  dependencies: ReattachDependencies,
): Promise<Partial<AgentPlanStepResult>> {
  const record = node.record;
  if (!record?.contract || !record.requested.options || !dependencies.local)
    throw new AgentError("plan_context_changed");
  const launch = await dependencies.local.sharedInput(
    record.instanceId,
    record.attemptId,
  );
  const session = await dependencies.local.reattach(
    record,
    node.control.signal,
    dependencies.observer(node),
  );
  return dependencies.finish(node, session, {
    contract: record.contract,
    reach: planSessionReach(
      record.runner === "api" ? node.step.provider : record.runner,
      record.requested.options,
    ),
    instruction: launch.instruction,
  });
}

interface RestoreDependencies {
  readonly local?: LocalSessions;
  readonly groups: AgentPlanGroupSessions;
  readonly retained: Map<string, NodeRun[]>;
  readonly groupInputs: Map<string, Promise<AgentPlanSnapshot>>;
  readonly save: (record: AgentPlanSessionRecord) => Promise<void>;
  readonly observer: (node: NodeRun) => PlanSessionObserver;
  readonly start: Pick<AgentPlanStepStart, "prepare">;
  readonly instruction?: NonNullable<NodeRun["control"]["runInstruction"]>;
  readonly offer: (
    node: NodeRun,
    key: string,
    input: () => Promise<AgentPlanSessionInput>,
  ) => void;
  readonly trackInstruction?: (
    instanceId: string,
    pending: PlanSession["turn"],
  ) => void;
}

/** Reconstructs group, loop and event-agent holders around the same proven native owners. */
export async function restoreLocalStepSessions(
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
  dependencies: RestoreDependencies,
): Promise<void> {
  const local = dependencies.local;
  if (!local) return;
  const nodes: NodeRun[] = [];
  for (const result of allPlanRunResults(run)) {
    const record = result.session;
    const step = snapshot.steps.find(
      (candidate) => candidate.step.id === result.id,
    );
    if (
      !record ||
      !step ||
      !local.has(record.instanceId) ||
      record.closeout === "confirmed"
    )
      continue;
    const stored = storedPlanNodeInput(run, step, result);
    const node = createNodeRun(stored.run, snapshot, stored.step, {
      signal: new AbortController().signal,
      iteration: storedPlanIteration(run, result),
      save: dependencies.save,
      runInstruction: dependencies.instruction,
    });
    node.record = record;
    node.hasStarted = record.startedAt !== null;
    nodes.push(node);
    if (node.sessionGroup && result.status === "succeeded") {
      const key = `${run.id}/${node.sessionGroup}`;
      dependencies.retained.set(key, [
        ...(dependencies.retained.get(key) ?? []),
        node,
      ]);
    }
  }
  await restoreHolders(nodes, dependencies);
  for (const node of nodes) {
    if (node.sessionGroup && node.step.groupId)
      dependencies.offer(node, `${run.id}/${node.sessionGroup}`, () =>
        restoredInput(node, dependencies),
      );
  }
}

async function restoreHolders(
  nodes: readonly NodeRun[],
  dependencies: RestoreDependencies,
): Promise<void> {
  if (!dependencies.local) return;
  const instances = new Set(
    nodes.flatMap((node) => (node.record ? [node.record.instanceId] : [])),
  );
  for (const instanceId of instances) {
    const launch = await dependencies.local.sharedInput(instanceId);
    const candidates = nodes.filter(
      (node) => node.record?.instanceId === instanceId,
    );
    const current =
      candidates.find((node) => node.record?.attemptId === launch.attemptId) ??
      candidates.at(-1);
    if (current) await restoreHolder(current, dependencies);
  }
}

async function restoreHolder(
  node: NodeRun,
  dependencies: RestoreDependencies,
): Promise<void> {
  const local = dependencies.local;
  const record = node.record;
  if (!local || !record || !node.sessionGroup) return;
  const key = `${node.run.id}/${node.sessionGroup}`;
  const launch = await local.sharedInput(record.instanceId);
  const session = await local.reattach(
    record,
    node.control.signal,
    launch.isInstruction ? JOURNAL_ONLY : dependencies.observer(node),
    { current: true },
  );
  if (launch.isInstruction)
    dependencies.trackInstruction?.(record.instanceId, session.turn);
  const milestones = await local.milestones(record.instanceId);
  const started = milestones.find((mutation) => mutation.kind === "started");
  const position = milestones.find((mutation) => mutation.kind === "position");
  dependencies.groups.restore(key, {
    record,
    stepId: node.step.step.id,
    userId: node.run.userId,
    mcp: restoredLocalMcp(launch),
    session,
    started: started?.kind === "started" ? started.details : null,
    turns: position?.kind === "position" ? position.turns : undefined,
  });
  dependencies.groupInputs.set(key, Promise.resolve(node.snapshot));
}

async function restoredInput(
  node: NodeRun,
  dependencies: RestoreDependencies,
): Promise<AgentPlanSessionInput> {
  const local = dependencies.local;
  const record = node.record;
  if (!local || !record?.requested.options || !record.requested.directory)
    throw new AgentError("plan_context_changed");
  const prepared = await dependencies.start.prepare(
    node.run,
    node.snapshot,
    node.step,
  );
  const launch = await local.sharedInput(record.instanceId, record.attemptId);
  if (prepared.input.directory !== record.requested.directory)
    throw new AgentError("plan_context_changed");
  return {
    ...prepared.input,
    directory: record.requested.directory,
    options: record.requested.options,
    instanceId: record.instanceId,
    mcp: restoredLocalMcp(launch),
    prompt: launch.prompt,
    acceptanceInstruction: launch.instruction,
    recording: sessionStart(node, record.instanceId) ?? undefined,
    resourceContext: {
      planId: node.run.planId,
      runId: node.run.id,
      stepId: node.step.step.id,
      sessionScopeId: launch.sessionScopeId,
    },
  };
}
