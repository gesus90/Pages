import { databaseFailureFacts } from "@/backend/logging/LogError";
import {
  logCaughtError,
  logEvent,
  withLogContext,
} from "@/backend/logging/Logger";
import { throwShutdownFailures } from "@/backend/runtime/ShutdownSteps";

import type { ActivePlanRun } from "./AgentPlanRunState";

/** How long a stopped run may take to close before the caller gives up waiting. */
export const STOP_WAIT_MILLISECONDS = 30_000;

/** What the stop of the plan engine works on. */
export interface PlanEngineShutdownInput {
  readonly active: ReadonlyMap<string, ActivePlanRun>;
  readonly pending: ReadonlySet<Promise<void>>;
  /** Saves one run as interrupted and aborts its executions. */
  readonly interrupt: (id: string) => Promise<void>;
  readonly pump: () => Promise<void>;
}

/**
 * Interrupts one run; its failure does not touch the other runs of the stop.
 *
 * @remarks
 * Its executions are aborted even when the interruption could not be saved.
 * The startup recovery then records the run as interrupted.
 */
async function interruptForShutdown(
  input: PlanEngineShutdownInput,
  id: string,
): Promise<unknown> {
  try {
    await input.interrupt(id);
    return null;
  } catch (error: unknown) {
    const active = input.active.get(id);
    if (active)
      for (const controller of active.controllers.values()) controller.abort();
    withLogContext({ runId: id }, () =>
      logEvent({
        level: "error",
        event: "agent.run.interrupt_failed",
        component: "AgentPlanRunEngine",
        message:
          "Agent plan run could not be saved as interrupted; the startup recovery records it",
        error,
        metadata: { ...databaseFailureFacts(error) },
      }),
    );
    return error;
  }
}

/** Whether the executions ended within {@link STOP_WAIT_MILLISECONDS}. */
async function drainWithin(
  pending: ReadonlySet<Promise<void>>,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all([...pending]).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), STOP_WAIT_MILLISECONDS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Closes every active run as interrupted, drains its executions and settles.
 *
 * @param input - The runs, their executions and the operations of the engine.
 * @throws The failure of a run, or an `AggregateError`; every run was attempted.
 *
 * @remarks
 * A shutdown is no decision of the executor: the runs close as interrupted, not
 * stopped. One run whose record cannot be saved must not leave the others
 * running (PAGE-199).
 */
export async function shutdownPlanEngine(
  input: PlanEngineShutdownInput,
): Promise<void> {
  const failures: unknown[] = [];
  for (const id of [...input.active.keys()]) {
    const failure = await interruptForShutdown(input, id);
    if (failure !== null) failures.push(failure);
  }
  if (!(await drainWithin(input.pending)))
    failures.push(
      new Error("Agent plan shutdown timed out; reservations remain held."),
    );
  try {
    await input.pump();
  } catch (error: unknown) {
    logCaughtError("AgentPlanRunEngine", error);
    failures.push(error);
  }
  throwShutdownFailures(failures);
}
