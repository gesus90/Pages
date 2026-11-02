import {
  planReceivesEvents,
  planReportsPassed,
} from "@/definition/AgentPlanBranching";

import {
  loopSessionTerms,
  planSessionGroup,
} from "./loop/AgentPlanLoopSession";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "./AgentPlanSnapshot";
import type { NodeRun, StepRunControl } from "./AgentPlanStepContext";

/**
 * Builds the state of one start of a node before anything runs.
 *
 * @param run - The current view of the plan run.
 * @param snapshot - The frozen plan.
 * @param step - The frozen node.
 * @param control - The stop signal, the persistence of the record and the event that started the node again.
 *
 * @remarks
 * A start that an event began is a new start: the retries of the one before are
 * over. An agent that other nodes send events to owns a session under its own
 * node, which stays open between its starts.
 */
export function createNodeRun(
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
  step: AgentPlanStepSnapshot,
  control: StepRunControl,
): NodeRun {
  const previous = run.steps.find(
    (result) => result.id === step.step.id,
  )?.session;
  const loop = loopSessionTerms(step, snapshot, control.iteration);
  const retry = control.event ? null : (previous?.retry ?? null);
  const receivesEvents =
    step.loopId === undefined &&
    step.groupId === undefined &&
    planReceivesEvents(snapshot.plan, step.step.id);
  return {
    run,
    snapshot,
    step,
    control,
    record: retry ? (previous ?? null) : null,
    hasStarted: false,
    retry,
    retryResumeSessionId: null,
    retryAttemptNumber: 1,
    retryGroup: null,
    loop,
    sessionGroup:
      planSessionGroup(step, loop) ??
      (receivesEvents ? step.step.id : undefined),
    event: control.event ?? null,
    eventMode: null,
    receivesEvents,
    reportsPassed: planReportsPassed(snapshot.plan, step.step.id),
  };
}
