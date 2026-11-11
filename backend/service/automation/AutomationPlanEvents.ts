import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";
import { failureReason } from "@/backend/service/agents/AgentPlanRunTransitions";

import type { AgentPlanRunObserver } from "@/backend/service/agents/AgentPlanRunObservers";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AutomationEventType } from "@/definition/Automation";
import type { AutomationEventRepository } from "@/backend/database/repositories/automation/AutomationEventRepository";
import type { AutomationPlanEventData } from "./AutomationEventData";

/** Step states a step change reports: a start and every end. */
const REPORTED_STEP_STATES: ReadonlySet<string> = new Set([
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
const ACTIVE_RUN_STATES: ReadonlySet<string> = new Set([
  "running",
  "pausing",
  "paused",
  "stopping",
]);

function changedSteps(
  previous: AgentPlanRun,
  next: AgentPlanRun,
): readonly AgentPlanStepResult[] {
  return next.steps.filter((step) => {
    const before = previous.steps.find((entry) => entry.id === step.id);
    return (
      before?.status !== step.status && REPORTED_STEP_STATES.has(step.status)
    );
  });
}

function endingEvent(
  previous: AgentPlanRun,
  next: AgentPlanRun,
): AutomationEventType | null {
  if (
    !ACTIVE_RUN_STATES.has(previous.status) ||
    ACTIVE_RUN_STATES.has(next.status)
  )
    return null;
  if (next.status === "succeeded") return "plan.succeeded";
  if (next.status === "failed" || next.status === "work_done_closeout_open")
    return "plan.failed";
  return null;
}

/**
 * Writes the events of plan runs to the inbox of automations (PAGE-297).
 *
 * @remarks
 * It observes the existing state changes of runs, so no second engine
 * watches the plans: a stored new run is `plan.started`, an ending
 * `plan.succeeded` or `plan.failed`, and every start or end of a step
 * `plan.step_changed`. Like every observer it only queues its writes; the
 * inbox keeps an event only while an active automation waits for its type.
 */
export class AutomationPlanEvents implements AgentPlanRunObserver {
  private readonly events: Pick<AutomationEventRepository, "record">;
  private readonly now: () => Date;

  public constructor(
    events: Pick<AutomationEventRepository, "record">,
    now: () => Date = (): Date => new Date(),
  ) {
    this.events = events;
    this.now = now;
  }

  /** Records `plan.started` for a newly stored run. */
  public runStarted(run: AgentPlanRun): void {
    this.record("plan.started", run, null);
  }

  /** Records the ending of a run and the starts and ends of its steps. */
  public runChanged(previous: AgentPlanRun, next: AgentPlanRun): void {
    for (const step of changedSteps(previous, next))
      this.record("plan.step_changed", next, step);
    const ending = endingEvent(previous, next);
    if (ending) {
      const failed =
        next.steps.find((step) => step.status === "failed") ?? null;
      this.record(ending, next, ending === "plan.failed" ? failed : null);
    }
  }

  private record(
    eventType: AutomationEventType,
    run: AgentPlanRun,
    step: AgentPlanStepResult | null,
  ): void {
    const at = this.now().toISOString();
    const eventData: AutomationPlanEventData = {
      event: eventType,
      at,
      plan: { id: run.planId, name: run.planName },
      run: { id: run.id, status: run.status },
      step: step ? { id: step.id, name: step.name, status: step.status } : null,
      error: eventType === "plan.failed" ? failureReason(run) : null,
    };
    void withBackgroundDatabaseWork("automation_plan_event", () =>
      this.events.record({
        eventType,
        payload: JSON.stringify(eventData),
        actorId: run.userId,
        occurredAt: at,
      }),
    ).catch((error: unknown) => {
      logCaughtError("AutomationPlanEvents", error);
    });
  }
}
