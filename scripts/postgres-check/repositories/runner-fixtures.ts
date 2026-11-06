import { RunnerHistoryRecoveryRepository } from "@/backend/database/repositories/runner/RunnerHistoryRecoveryRepository";
import {
  appendRunnerSessionEvents,
  prepareRunnerSessionEvents,
} from "@/backend/database/repositories/runner/RunnerSessionEvents";
import {
  ATTEMPT,
  remoteExecutionFixture,
  runFixture,
  sessionFixture,
  stepFixture,
} from "./plan-fixtures";
import { call, refused } from "./world";

import type { RepositoryStep, RepositoryWorld } from "./world";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { RunnerLiveEvent } from "@/definition/RunnerLiveHistory";
import type {
  RunnerJob,
  RunnerMessage,
  RunnerPlanBinding,
  RunnerState,
} from "@/definition/RunnerProtocol";

export const PLAN_ID = "99999999-9999-4999-8999-999999999999";
export const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const JOB_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_JOB_ID = "77777777-7777-4777-8777-777777777777";
export const RUNNER_SESSION_ID = "88888888-8888-4888-8888-888888888888";

export const RUNNER_BINDING: RunnerPlanBinding = {
  planId: PLAN_ID,
  runId: RUN_ID,
  stepId: "review",
  attemptId: ATTEMPT,
  planRevision: 1,
};

export const JOB: RunnerJob = {
  jobId: JOB_ID,
  sessionId: RUNNER_SESSION_ID,
  plan: RUNNER_BINDING,
  execution: {
    version: 1,
    revision: 1,
    workspace: "/srv/plans",
    timeoutSeconds: 60,
    outputBytes: 1024,
    input: "",
    program: {
      kind: "cli",
      route: {
        connectionId: RUNNER_SESSION_ID,
        workspaceId: RUNNER_SESSION_ID,
        catalogRevision: "catalog-1",
        tool: "codex",
      },
      model: "model-a",
      reasoningEffort: null,
      prompt: "Prüfe",
      access: "read_only",
    },
  },
  status: "running",
};

export const OTHER_JOB: RunnerJob = {
  jobId: OTHER_JOB_ID,
  sessionId: RUNNER_SESSION_ID,
  status: "queued",
};

export const RUNNER_RUN = runFixture(RUN_ID, PLAN_ID, {
  steps: [
    stepFixture("review", {
      status: "running",
      session: sessionFixture({ instanceId: JOB_ID }),
      execution: remoteExecutionFixture(RUN_ID, PLAN_ID),
    }),
  ],
});

/**
 * The state a runner acknowledged.
 *
 * @param jobs - Its jobs.
 * @returns The state.
 */
export function runnerState(jobs: readonly RunnerJob[]): RunnerState {
  return {
    version: 1,
    sessionId: RUNNER_SESSION_ID,
    sequence: 1,
    lastEventId: null,
    jobs: [...jobs],
  };
}

/**
 * An event of the running job.
 *
 * @param eventId - The event.
 * @param sequence - Its place in the runner session.
 * @param history - The diagnostic packet it carries.
 * @returns The event.
 */
export function planEvent(
  eventId: string,
  sequence: number,
  history: readonly RunnerLiveEvent[],
): Extract<RunnerMessage, { type: "event" }> {
  return {
    version: 1,
    type: "event",
    sessionId: RUNNER_SESSION_ID,
    eventId,
    sequence,
    job: JOB,
    history: [...history],
  };
}

/**
 * A step that runs one call inside a transaction.
 *
 * @param name - The method or function it calls.
 * @param run - The call.
 * @returns The step.
 */
export function callInTransaction(
  name: string,
  run: (
    world: RepositoryWorld,
    transaction: DatabaseTransaction,
  ) => Promise<unknown>,
): RepositoryStep {
  return call(name, (world) =>
    world.database.transaction((transaction) => run(world, transaction)),
  );
}

/** Appends actual prepared runner history through the existing receipt transaction. */
export function appendPreparedRunnerEvents(
  events: readonly RunnerLiveEvent[],
  launchId?: string,
): RepositoryStep {
  return call("appendRunnerSessionEvents", async ({ database }) => {
    const input = { binding: RUNNER_BINDING, jobId: JOB_ID, events, launchId };
    const prepared = await prepareRunnerSessionEvents(database, input);
    return database.transaction((transaction) =>
      appendRunnerSessionEvents(transaction, { ...input, prepared }),
    );
  });
}

/** Retains one synchronized custody packet on the same repository instance. */
export function retainPreparedHistory(
  connectionId: string,
  event: Parameters<RunnerHistoryRecoveryRepository["prepare"]>[0],
  isRefusal = false,
): RepositoryStep {
  return (isRefusal ? refused : call)(
    "RunnerHistoryRecoveryRepository.retain",
    async ({ database }) => {
      const repository = new RunnerHistoryRecoveryRepository(database);
      await repository.prepare(event);
      return database.transaction((transaction) =>
        repository.retain(transaction, connectionId, event),
      );
    },
  );
}
