import { createHash } from "node:crypto";

import { failureReason } from "./AgentPlanRunTransitions";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

const STATE_KEY_LENGTH = 16;

function stepState(step: AgentPlanStepResult): unknown[] {
  return [
    step.id,
    step.status,
    step.isBlocked,
    step.activation ?? null,
    step.history?.length ?? 0,
    step.branch ?? null,
  ];
}

/**
 * Describes everything of a run that its structure view shows.
 *
 * @param run - The stored view of the run.
 * @returns A text that changes exactly when the state of the run, of a node,
 * of a loop or of one of its iterations, the failure or the end changes.
 *
 * @remarks
 * Results, outputs, sessions and progress records are no part of it, so a
 * write that only records progress keeps it. Nested states count as much as
 * the outer ones: a new iteration or a member that starts inside a running
 * loop changes the text although no outer step changes.
 */
export function planRunVisibleState(run: AgentPlanRun): string {
  return JSON.stringify([
    run.status,
    run.endedAt ?? null,
    run.controlError ?? null,
    failureReason(run),
    run.steps.map(stepState),
    (run.loops ?? []).map((loop) => [
      loop.id,
      loop.status,
      loop.completion,
      loop.count?.effective ?? null,
      loop.iterations.map((iteration) => [
        iteration.number,
        iteration.status,
        iteration.nodes.map(stepState),
      ]),
    ]),
  ]);
}

/**
 * A short key of {@link planRunVisibleState}.
 *
 * @param run - The stored view of the run.
 * @returns 16 hexadecimal digits; equal keys stand for an equal visible state.
 */
export function planRunStateKey(run: AgentPlanRun): string {
  return createHash("sha256")
    .update(planRunVisibleState(run))
    .digest("hex")
    .slice(0, STATE_KEY_LENGTH);
}
