import { strict as assert } from "node:assert";

import { RunnerDeployKeyRepository } from "@/backend/database/repositories/runner/RunnerDeployKeyRepository";
import { RunnerHistoryRecoveryRepository } from "@/backend/database/repositories/runner/RunnerHistoryRecoveryRepository";
import { RunnerPlanEventRepository } from "@/backend/database/repositories/runner/RunnerPlanEventRepository";
import { RunnerRepository } from "@/backend/database/repositories/runner/RunnerRepository";
import {
  appendRunnerSessionEvents,
  persistRunnerSessionEvents,
  prepareRunnerSessionEvents,
  runnerSessionState,
} from "@/backend/database/repositories/runner/RunnerSessionEvents";
import { persistRunnerSessionUsage } from "@/backend/database/repositories/runner/RunnerSessionUsage";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";

import {
  ATTEMPT,
  DIGEST,
  OWNER,
  planFixture,
  remoteExecutionFixture,
  runFixture,
  sessionFixture,
  snapshotFixture,
  stepFixture,
} from "./plan-fixtures";
import {
  callInTransaction,
  appendPreparedRunnerEvents,
  retainPreparedHistory,
  JOB,
  JOB_ID,
  OTHER_JOB,
  PLAN_ID,
  planEvent,
  RUN_ID,
  RUNNER_BINDING,
  RUNNER_RUN,
  RUNNER_SESSION_ID,
  runnerState,
} from "./runner-fixtures";
import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
  stored,
} from "./world";

import { inOrder } from "./saved-order-flows";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { RunnerLiveEvent } from "@/definition/RunnerLiveHistory";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";

const LAUNCH_ID = "55555555-5555-4555-8555-555555555555";
const HISTORY_EMPTY = "10000000-0000-4000-8000-000000000000";
const HISTORY_A = "20000000-0000-4000-8000-000000000000";
const HISTORY_B = "30000000-0000-4000-8000-000000000000";
const HISTORY_OTHER = "40000000-0000-4000-8000-000000000000";

const LIVE_EVENT: RunnerLiveEvent = {
  sequence: 1,
  kind: "agent_message",
  text: "Vom Runner",
  createdAt: "2026-03-01T08:00:00.000Z",
  isTruncated: false,
};

const REMOTE_STEP: AgentPlanStepResult = stepFixture("review", {
  status: "running",
  execution: remoteExecutionFixture(RUN_ID, PLAN_ID),
  session: sessionFixture({ instanceId: JOB_ID }),
  remote: {
    jobId: JOB_ID,
    sessionId: RUNNER_SESSION_ID,
    status: "running",
    liveHistoryVersion: 1,
    outputJournalVersion: 2,
    launchId: LAUNCH_ID,
    closeout: "pending",
    startedAt: null,
    endedAt: "2026-03-01T09:00:00.000Z",
    terminal: {
      version: 1,
      provider: "codex",
      sessionId: null,
      event: "result",
      status: "completed",
      usage: {
        inputTokens: 5,
        outputTokens: null,
        cacheReadTokens: 1,
      },
      eventDigest: DIGEST,
      answerDigest: DIGEST,
    },
  },
});

function deployKeys({ database }: RepositoryWorld): RunnerDeployKeyRepository {
  return new RunnerDeployKeyRepository(database);
}

function history({
  database,
}: RepositoryWorld): RunnerHistoryRecoveryRepository {
  return new RunnerHistoryRecoveryRepository(database);
}

function events({ database }: RepositoryWorld): RunnerPlanEventRepository {
  return new RunnerPlanEventRepository(database);
}

function runners({ database }: RepositoryWorld): RunnerRepository {
  return new RunnerRepository(database);
}

const RUNNER_RECORD = {
  connectionId: "connection-runner",
  runnerId: "runner-1",
  tokenHash: DIGEST,
  connectionRevision: 3,
  state: runnerState([JOB, OTHER_JOB]),
};

/** The public keys a project registered for runners. */
export const RUNNER_DEPLOY_KEY_FLOW: RepositoryFlow = {
  title: "runner deploy keys",
  steps: [
    call("RunnerDeployKeyRepository.list", (world) =>
      deployKeys(world).list("project-keys"),
    ),
    call("RunnerDeployKeyRepository.create", async (world) => {
      const key = await deployKeys(world).create({
        projectId: "project-keys",
        key: "ssh-ed25519 BBBB",
        title: "Zweiter",
      });
      return { key: key.key, title: key.title };
    }),
    call("RunnerDeployKeyRepository.create", async (world) => {
      const key = await deployKeys(world).create({
        projectId: "project-keys",
        key: "ssh-ed25519 AAAA",
        title: "Erster",
      });
      return { key: key.key, title: key.title };
    }),
    call("RunnerDeployKeyRepository.create", async (world) => {
      const key = await deployKeys(world).create({
        projectId: "project-keys",
        key: "ssh-ed25519 BBBB",
        title: "Anderer Titel",
      });
      return { key: key.key, title: key.title };
    }),
    reversedInPostgres("runner_deploy_keys"),
    call("RunnerDeployKeyRepository.list", (world) =>
      deployKeys(world).list("project-keys"),
    ),
    refused("RunnerDeployKeyRepository.create", (world) =>
      deployKeys(world).create({
        projectId: "project-keys",
        key: "ssh-ed25519 CCCC",
        title: MISSING_TEXT,
      }),
    ),
  ],
};

/** The pairing of a runner and its acknowledged state. */
export const RUNNER_FLOW: RepositoryFlow = {
  title: "runners",
  steps: [
    call("RunnerRepository.find", (world) =>
      runners(world).find("connection-runner"),
    ),
    call("RunnerRepository.create", (world) =>
      runners(world).create(RUNNER_RECORD),
    ),
    call("RunnerRepository.find", (world) =>
      runners(world).find("connection-runner"),
    ),
    refused("RunnerRepository.create", (world) =>
      runners(world).create(RUNNER_RECORD),
    ),
    call("RunnerRepository.checkpoint", (world) =>
      runners(world).checkpoint(
        "connection-runner",
        { ...RUNNER_RECORD.state, sequence: 2 },
        () => Promise.resolve(),
      ),
    ),
    call("RunnerRepository.checkpoint", (world) =>
      runners(world).checkpoint("connection-runner", {
        ...RUNNER_RECORD.state,
        sequence: 3,
      }),
    ),
    call("RunnerRepository.find", (world) =>
      runners(world).find("connection-runner"),
    ),
    refused("RunnerRepository.checkpoint", (world) =>
      runners(world).checkpoint(
        "connection-runner",
        { ...RUNNER_RECORD.state, sequence: 4 },
        () => Promise.reject(new Error("The flow ends this journal.")),
      ),
    ),
    stored(
      "SELECT state_json FROM pages_runners WHERE connection_id = 'connection-runner';",
    ),
    call("RunnerRepository.remove", (world) =>
      runners(world).remove("connection-absent"),
    ),
  ],
};

/** Receipts of runner events and the progress they bring. */
export const RUNNER_EVENT_FLOW: RepositoryFlow = {
  title: "runner events",
  steps: [
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(
        planFixture(PLAN_ID, { name: "Runner" }),
        true,
      ),
    ),
    call("AgentPlanRunRepository.create", ({ database }) =>
      new AgentPlanRunRepository(database).create(
        RUNNER_RUN,
        snapshotFixture(planFixture(PLAN_ID)),
        [],
      ),
    ),
    call("RunnerPlanEventRepository.receipt", (world) =>
      events(world).receipt("event-1"),
    ),
    callInTransaction(
      "RunnerPlanEventRepository.append",
      (world, transaction) =>
        events(world).append(transaction, "connection-runner", {
          event: planEvent("event-1", 1, []),
          digest: DIGEST,
        }),
    ),
    call("RunnerPlanEventRepository.receipt", (world) =>
      events(world).receipt("event-1"),
    ),
    refused("RunnerPlanEventRepository.append", ({ database }) =>
      database.transaction((transaction) =>
        new RunnerPlanEventRepository(database).append(
          transaction,
          "connection-runner",
          { event: planEvent("event-1", 2, []), digest: DIGEST },
        ),
      ),
    ),
    callInTransaction(
      "RunnerPlanEventRepository.requireDispatchFence",
      (world, transaction) =>
        events(world).requireDispatchFence(transaction, RUNNER_BINDING),
    ),
    refused("RunnerPlanEventRepository.requireDispatchFence", ({ database }) =>
      database.transaction((transaction) =>
        new RunnerPlanEventRepository(database).requireDispatchFence(
          transaction,
          { ...RUNNER_BINDING, attemptId: "attempt-other" },
        ),
      ),
    ),
    call("RunnerPlanEventRepository.fenceStoppedRuns", (world) =>
      events(world).fenceStoppedRuns(
        runnerState([
          JOB,
          { jobId: "job-free", sessionId: RUNNER_SESSION_ID, status: "queued" },
          {
            ...JOB,
            jobId: "job-unknown-run",
            plan: { ...RUNNER_BINDING, runId: "run-unknown" },
          },
        ]),
      ),
    ),
    callInTransaction("RunnerPlanEventRepository.apply", (world, transaction) =>
      events(world).apply(transaction, RUN_ID, (run) => ({ run })),
    ),
    stored("SELECT recovery_revision FROM agent_plan_runs WHERE id = $id;", {
      id: RUN_ID,
    }),
    callInTransaction("RunnerPlanEventRepository.apply", (world, transaction) =>
      events(world).apply(
        transaction,
        RUN_ID,
        (run, snapshot) => ({
          run: {
            ...run,
            planName:
              typeof snapshot === "object" && snapshot !== null
                ? "Mit Basis"
                : "Ohne Basis",
          },
        }),
        { stepId: "review", events: [] },
      ),
    ),
    call("AgentPlanRunRepository.find", ({ database }) =>
      new AgentPlanRunRepository(database).find(RUN_ID),
    ),
    refused("RunnerPlanEventRepository.apply", ({ database }) =>
      database.transaction((transaction) =>
        new RunnerPlanEventRepository(database).apply(
          transaction,
          "run-unknown",
          (run) => ({ run }),
        ),
      ),
    ),
    call("RunnerPlanEventRepository.changeRun", (world) =>
      events(world).changeRun(RUN_ID, (run) => ({
        ...run,
        stopRequested: true,
      })),
    ),
    call("RunnerPlanEventRepository.fenceStoppedRuns", async (world) =>
      (await events(world).fenceStoppedRuns(runnerState([JOB]))).jobs.map(
        (job) => ({ jobId: job.jobId, isStopped: Boolean(job.cancellation) }),
      ),
    ),
    refused("RunnerPlanEventRepository.changeRun", (world) =>
      events(world).changeRun("run-unknown", (run) => run),
    ),
    refused("RunnerPlanEventRepository.requireDispatchFence", ({ database }) =>
      database.transaction((transaction) =>
        new RunnerPlanEventRepository(database).requireDispatchFence(
          transaction,
          RUNNER_BINDING,
        ),
      ),
    ),
  ],
};

/** Session history a runner delivered, and its usage. */
export const RUNNER_SESSION_FLOW: RepositoryFlow = {
  title: "runner sessions",
  steps: [
    call("runnerSessionState", async () =>
      (["succeeded", "running", "failed", "cancelled"] as const).map((status) =>
        runnerSessionState(stepFixture("x", { status })),
      ),
    ),
    refused("runnerSessionState", async () =>
      runnerSessionState(stepFixture("x", { status: "waiting" })),
    ),
    callInTransaction("persistRunnerSessionEvents", (_world, transaction) =>
      persistRunnerSessionEvents(
        transaction,
        runFixture("run-none", PLAN_ID, { steps: [stepFixture("review")] }),
        { stepId: "review", events: [] },
      ),
    ),
    call("persistRunnerSessionEvents", async ({ database }) => {
      const prepared = await prepareRunnerSessionEvents(database, {
        binding: RUNNER_BINDING,
        jobId: JOB_ID,
        launchId: LAUNCH_ID,
        events: [LIVE_EVENT],
      });
      return database.transaction((transaction) =>
        persistRunnerSessionEvents(
          transaction,
          runFixture(RUN_ID, PLAN_ID, { steps: [REMOTE_STEP] }),
          { stepId: "review", events: [LIVE_EVENT], prepared },
        ),
      );
    }),
    callInTransaction("persistRunnerSessionEvents", (_world, transaction) =>
      persistRunnerSessionEvents(
        transaction,
        runFixture(RUN_ID, PLAN_ID, { steps: [REMOTE_STEP] }),
        { stepId: "review", events: [] },
      ),
    ),
    call("AgentSessionRepository.findAttempt", async ({ database }) => {
      const attempt = await new AgentSessionRepository(database).findAttempt(
        ATTEMPT,
      );
      return attempt && { ...attempt, updatedAt: "<clock>" };
    }),
    stored(
      "SELECT next_sequence FROM agent_session_attempts WHERE attempt_id = $id;",
      { id: ATTEMPT },
    ),
    call("AgentSessionRepository.readEvents", ({ database }) =>
      new AgentSessionRepository(database).readEvents(ATTEMPT, 0, 10),
    ),
    call("AgentSessionRepository.listRunUsage", async ({ database }) =>
      (await new AgentSessionRepository(database).listRunUsage(RUN_ID)).map(
        (usage) => ({ ...usage, reportedAt: "<clock>" }),
      ),
    ),
    appendPreparedRunnerEvents(
      [{ ...LIVE_EVENT, sequence: 2, text: "password=geheim und mehr" }],
      LAUNCH_ID,
    ),
    appendPreparedRunnerEvents([
      { ...LIVE_EVENT, sequence: 2_005, text: "x".repeat(4_000) },
    ]),
    stored(
      "SELECT next_sequence FROM agent_session_attempts WHERE attempt_id = $id;",
      { id: ATTEMPT },
    ),
    stored(
      "SELECT sequence, body, is_truncated, turn FROM agent_session_events WHERE attempt_id = $id ORDER BY sequence;",
      { id: ATTEMPT },
    ),
    stored(
      "SELECT launch_id, chunk_index, first_sequence, last_sequence FROM agent_session_history_chunks WHERE attempt_id = $id ORDER BY chunk_index;",
      { id: ATTEMPT },
    ),
    refused("appendRunnerSessionEvents", ({ database }) =>
      database.transaction((transaction) =>
        appendRunnerSessionEvents(transaction, {
          binding: RUNNER_BINDING,
          jobId: "job-other",
          events: [],
        }),
      ),
    ),
    refused("appendRunnerSessionEvents", ({ database }) =>
      database.transaction((transaction) =>
        appendRunnerSessionEvents(transaction, {
          binding: RUNNER_BINDING,
          jobId: JOB_ID,
          events: [{ ...LIVE_EVENT, sequence: 2_005 }],
        }),
      ),
    ),
    callInTransaction("persistRunnerSessionUsage", (_world, transaction) =>
      persistRunnerSessionUsage(transaction, stepFixture("review")),
    ),
    callInTransaction("persistRunnerSessionUsage", (_world, transaction) =>
      persistRunnerSessionUsage(transaction, REMOTE_STEP),
    ),
    refusedWithoutTable(
      "persistRunnerSessionUsage",
      "agent_session_turn_usage",
      (transaction) => persistRunnerSessionUsage(transaction, REMOTE_STEP),
    ),
  ],
};

/** History packets kept until their archive took them, one job after the other. */
export const RUNNER_HISTORY_FLOW: RepositoryFlow = {
  title: "runner history recovery",
  steps: [
    call("RunnerHistoryRecoveryRepository.pendingConnections", (world) =>
      history(world).pendingConnections(),
    ),
    call("RunnerHistoryRecoveryRepository.hasPending", (world) =>
      history(world).hasPending("connection-runner"),
    ),
    call("RunnerHistoryRecoveryRepository.isPending", (world) =>
      history(world).isPending("history-1"),
    ),
    call("RunnerHistoryRecoveryRepository.pendingCount", (world) =>
      history(world).pendingCount(JOB_ID),
    ),
    call("RunnerHistoryRecoveryRepository.restore", (world) =>
      history(world).restore("connection-runner"),
    ),
    retainPreparedHistory("connection-runner", planEvent(HISTORY_EMPTY, 9, [])),
    stored(
      "SELECT COUNT(*) FROM runner_history_recovery WHERE event_id = '10000000-0000-4000-8000-000000000000';",
    ),
    retainPreparedHistory(
      "connection-runner",
      planEvent(HISTORY_B, 10, [{ ...LIVE_EVENT, sequence: 3000 }]),
    ),
    retainPreparedHistory(
      "connection-runner",
      planEvent(HISTORY_A, 10, [{ ...LIVE_EVENT, sequence: 3001 }]),
    ),
    retainPreparedHistory(
      "connection-other",
      planEvent(HISTORY_OTHER, 2, [{ ...LIVE_EVENT, sequence: 1 }]),
    ),
    retainPreparedHistory(
      "connection-runner",
      planEvent(HISTORY_A, 11, [{ ...LIVE_EVENT, sequence: 1 }]),
      true,
    ),
    prepare(`
      INSERT INTO runner_history_recovery (event_id, connection_id, job_id, sequence, packet_json)
      SELECT
          'limit-event-' || CAST(number AS TEXT),
          'connection-limit',
          'limit-job-' || CAST(number AS TEXT),
          5,
          '{}'
      FROM generate_series(1, 33) AS numbers(number);
    `),
    prepare(`
      INSERT INTO runner_history_recovery (event_id, connection_id, job_id, sequence, packet_json)
      SELECT
          'many-event-' || CAST(number AS TEXT),
          'connection-many-' || CAST(number AS TEXT),
          'many-job',
          1,
          '{}'
      FROM generate_series(1, 9) AS numbers(number);
    `),
    reversedInPostgres("runner_history_recovery"),
    call("RunnerHistoryRecoveryRepository.pendingConnections", (world) =>
      history(world).pendingConnections(),
    ),
    call("RunnerHistoryRecoveryRepository.restore", (world) =>
      history(world).restore("connection-limit"),
    ),
    stored(`
      SELECT event_id
      FROM runner_history_recovery
      WHERE connection_id = 'connection-limit'
          AND last_attempt_at IS NULL;
    `),
    prepare(
      "DELETE FROM runner_history_recovery WHERE event_id LIKE 'limit-event-%' OR event_id LIKE 'many-event-%';",
    ),
    call("RunnerHistoryRecoveryRepository.hasPending", (world) =>
      history(world).hasPending("connection-runner"),
    ),
    call("RunnerHistoryRecoveryRepository.isPending", (world) =>
      history(world).isPending(HISTORY_A),
    ),
    call("RunnerHistoryRecoveryRepository.pendingCount", (world) =>
      history(world).pendingCount(JOB_ID),
    ),
    prepare(
      "UPDATE pages_runners SET state_json = $state WHERE connection_id = 'connection-runner';",
      { state: JSON.stringify(RUNNER_RECORD.state) },
    ),
    call("RunnerHistoryRecoveryRepository.restore", (world) =>
      history(world).restore("connection-runner"),
    ),
    // Same job and sequence: the packet received first goes first, not the smaller id.
    call("stored", async ({ database }) =>
      inOrder(
        await database.query(`
          SELECT event_id
          FROM runner_history_recovery
          WHERE connection_id = 'connection-runner'
              AND restored_at IS NOT NULL;
        `),
        [HISTORY_B],
        (row) => row[0],
      ),
    ),
    stored(`
      SELECT event_id, restored_at IS NULL, last_attempt_at IS NULL, diagnosis_json IS NULL
      FROM runner_history_recovery
      WHERE connection_id = 'connection-runner'
      ORDER BY event_id;
    `),
    call("RunnerHistoryRecoveryRepository.restore", (world) =>
      history(world).restore("connection-runner"),
    ),
    prepare(
      "UPDATE runner_history_recovery SET last_attempt_at = '2020-01-01 00:00:00' WHERE restored_at IS NULL AND connection_id = 'connection-runner';",
    ),
    call("RunnerHistoryRecoveryRepository.restore", (world) =>
      history(world).restore("connection-runner"),
    ),
    stored(`
      SELECT event_id, restored_at IS NULL
      FROM runner_history_recovery
      WHERE connection_id = 'connection-runner'
      ORDER BY event_id;
    `),
    prepare(
      "UPDATE runner_history_recovery SET packet_file = jsonb_set(packet_file::JSONB, '{sha256}', to_jsonb(repeat('0', 64)))::TEXT WHERE event_id = '40000000-0000-4000-8000-000000000000';",
    ),
    call("RunnerHistoryRecoveryRepository.restore", async (world) => {
      assert.equal(await history(world).restore("connection-other"), 0);
      const [row] = await world.database.query(
        "SELECT restored_at, diagnosis_json FROM runner_history_recovery WHERE event_id = '40000000-0000-4000-8000-000000000000';",
      );
      assert.ok(row);
      assert.equal(row[0], null);
      assert.notEqual(row[1], null);
    }),
    call("RunnerRepository.remove", (world) =>
      runners(world).remove("connection-runner"),
    ),
    stored(
      "SELECT COUNT(*) FROM pages_runners WHERE connection_id = 'connection-runner';",
    ),
    prepare("DELETE FROM runner_history_recovery;"),
    prepare("UPDATE agent_plan_runs SET status = 'failed' WHERE id = $id;", {
      id: RUN_ID,
    }),
    stored(
      "SELECT user_id FROM agent_plan_runs WHERE id = $id AND user_id = $owner;",
      { id: RUN_ID, owner: OWNER },
    ),
  ],
};
