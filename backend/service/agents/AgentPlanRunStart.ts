import { randomUUID } from "node:crypto";

import { isPlanFlowNode } from "@/definition/AgentPlanGraph";
import {
  inPlanSequence,
  planFlowSequence,
} from "@/definition/AgentPlanSequence";

import { withGroupResults } from "./AgentPlanGroupResults";
import { initialLoopRuns } from "./loop/AgentPlanLoopRecord";

import { isPlanOuterRunStep, planStacks } from "@/definition/AgentPlanStack";
import type {
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanRunOrigin } from "@/definition/AgentPlanRecovery";
import type { AgentPlanStackRun } from "@/definition/AgentPlanStack";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

/** What a restart or resume carries over from the earlier run into the new one. */
export interface RecoveredRunStart {
  readonly origin: AgentPlanRunOrigin;
  /** Verified successful results, taken over unchanged; empty for a restart. */
  readonly reused: readonly AgentPlanStepResult[];
  /** Loop states whose completed iterations continue; a loop not named here starts empty. */
  readonly loops: readonly AgentPlanLoopRun[];
  /** What the stacks handed over so far, so no entry is handed over twice or skipped; absent for a restart. */
  readonly stacks?: readonly AgentPlanStackRun[];
}

/**
 * The view of a new run: every node waits, with a fresh identity.
 *
 * @remarks
 * The steps are stored in the order of the flow edges, Start first, so the
 * run keeps the numbering of the revision it executes.
 *
 * @param userId - The executor.
 * @param snapshot - The prepared revision.
 */
export function initialPlanRun(
  userId: string,
  snapshot: AgentPlanSnapshot,
): AgentPlanRun {
  const view: AgentPlanRun = {
    id: randomUUID(),
    planId: snapshot.plan.id,
    planName: snapshot.plan.name,
    planRevision: snapshot.plan.revision,
    userId,
    startedAt: new Date().toISOString(),
    status: "running",
    stopRequested: false,
    steps: inPlanSequence(
      snapshot.plan.nodes.filter(
        (node) =>
          isPlanFlowNode(node) && isPlanOuterRunStep(snapshot.plan, node),
      ),
      planFlowSequence(snapshot.plan).order,
    ).map((node) => ({
      id: node.id,
      groupId: snapshot.steps.find((step) => step.step.id === node.id)?.groupId,
      ...planStepRole(node),
      name: runStepName(snapshot, node),
      status: "waiting",
      isBlocked: false,
      cancellation: "none",
      output: null,
      error: null,
    })),
  };
  const loops = initialLoopRuns(snapshot);
  return withGroupResults(
    loops.length > 0 ? { ...view, loops } : view,
    snapshot,
  );
}

/**
 * The view of a run that a restart or resume of an earlier run starts.
 *
 * @remarks
 * Taken-over results keep their status, output and session record; the
 * scheduler treats them as completed dependencies and never starts them
 * again. Everything else waits, so the engine dispatches exactly the open
 * frontier of the earlier run. The stacks keep their deliveries, so a loop
 * member that runs again reads the entry its iteration was handed.
 */
export function recoveredPlanRun(
  userId: string,
  snapshot: AgentPlanSnapshot,
  recovered: RecoveredRunStart,
): AgentPlanRun {
  const initial = initialPlanRun(userId, snapshot);
  const steps = initial.steps.map(
    (step) => recovered.reused.find((entry) => entry.id === step.id) ?? step,
  );
  const loops = initial.loops?.map(
    (loop) => recovered.loops.find((entry) => entry.id === loop.id) ?? loop,
  );
  const stackIds = new Set(planStacks(snapshot.plan).map((stack) => stack.id));
  const stacks = (recovered.stacks ?? []).filter((stack) =>
    stackIds.has(stack.id),
  );
  return withGroupResults(
    {
      ...initial,
      origin: recovered.origin,
      steps,
      ...(loops ? { loops } : {}),
      ...(stacks.length > 0 ? { stacks } : {}),
    },
    snapshot,
  );
}

/**
 * The role a node hands to its result in the run.
 *
 * @param node - A node of the frozen plan.
 * @returns The field to spread into the result; empty for an ordinary work step.
 */
export function planStepRole(
  node: AgentPlanNode,
): Pick<AgentPlanStepResult, "role"> {
  return (node.type === "agent" ||
    node.type === "script" ||
    node.type === "git_closeout") &&
    node.role
    ? { role: node.role }
    : {};
}

function runStepName(snapshot: AgentPlanSnapshot, node: AgentPlanNode): string {
  const local = snapshot.steps.find((step) => step.step.id === node.id);
  if (local) return local.name;
  const remote = snapshot.remoteSteps?.find((step) => step.step.id === node.id);
  if (remote?.step.type === "agent")
    return remote.step.configuration?.name ?? node.type;
  if (node.type === "decision") return node.name ?? "Decision";
  return node.type === "loop" ||
    node.type === "script" ||
    node.type === "git_closeout" ||
    node.type === "stack"
    ? node.name
    : node.type;
}
