import { strict as assert } from "node:assert";
import { AcpResourceRepository } from "@/backend/database/repositories/agent/AcpResourceRepository";
import { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";
import { LocalSessionRepository } from "@/backend/database/repositories/agent/LocalSessionRepository";
import { PlanRunCommandRepository } from "@/backend/database/repositories/agent/PlanRunCommandRepository";
import { PlanRunOwnerRepository } from "@/backend/database/repositories/agent/PlanRunOwnerRepository";
import { RunApiCleanupRepository } from "@/backend/database/repositories/agent/RunApiCleanupRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { prepareSessionHistoryChunks } from "@/backend/database/repositories/agent/AgentSessionHistoryChunks";
import { readStoredEventRow } from "@/backend/database/repositories/agent/AgentSessionRows";
import { prepareRunnerSessionEvents } from "@/backend/database/repositories/runner/RunnerSessionEvents";
import { requireAgentFiles } from "@/backend/storage/AgentPayloadFileStore";
import { RUNNER_BINDING, JOB_ID } from "./runner-fixtures";
import { AgentPlanRemoteAccessRepository } from "@/backend/database/repositories/agent/AgentPlanRemoteAccessRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanStartRejectionRepository } from "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository";
import { AgentPlanStepReportRepository } from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import { AgentPlanWorkRepository } from "@/backend/database/repositories/agent/AgentPlanWorkRepository";

import {
  ATTEMPT,
  OTHER_USER,
  OWNER,
  planFixture,
  remoteExecutionFixture,
  runFixture,
  snapshotFixture,
  stepFixture,
} from "./plan-fixtures";
import {
  call,
  MISSING_TEXT,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";
import type { AgentPlanWorkRecord } from "@/definition/AgentPlanWork";

const PLAN = planFixture("plan-recovery", { name: "Wiederaufnahme" });
const SNAPSHOT = snapshotFixture(PLAN);
const WORK_KEY = {
  runId: "run-work",
  stepId: "review",
  attemptId: ATTEMPT,
  ticketId: "ticket-work",
};
const WORK_RECORD: AgentPlanWorkRecord = {
  revision: 1,
  requirementsHash: "requirements",
  contentHash: "content",
  scopeHash: "scope",
  scope: [],
  note: "Erledigt",
  proofs: [],
  checks: [],
  confirmed: true,
};
const REPORT_SLOT = {
  runId: "run-report",
  sessionScopeId: "scope-1",
  stepId: "review",
  attemptId: "attempt-1",
  termsJson: '{"terms":1}',
};
const REJECTION: AgentPlanStartRejection = {
  id: "rejection-1",
  createdAt: "2026-03-01T08:00:00.000Z",
  action: "play",
  planRevision: 1,
  isSavedRevision: true,
  error: "plan_conflict",
  conflict: null,
  reservation: "not_requested",
  targetResolution: "unknown",
};

function rejections({
  database,
}: RepositoryWorld): AgentPlanStartRejectionRepository {
  return new AgentPlanStartRejectionRepository(database);
}

function reports({ database }: RepositoryWorld): AgentPlanStepReportRepository {
  return new AgentPlanStepReportRepository(database);
}

async function insertRun(
  { database }: RepositoryWorld,
  run: AgentPlanRun,
): Promise<void> {
  await new AgentPlanRunRepository(database).create(run, SNAPSHOT, []);
}

/** Remote access evidence inside the stored view of a run. */
export const REMOTE_ACCESS_FLOW: RepositoryFlow = {
  title: "plan remote access",
  steps: [
    refused("AgentPlanRemoteAccessRepository.write", ({ database }) =>
      new AgentPlanRemoteAccessRepository(database).write(
        "run-missing",
        ATTEMPT,
        () => ({ files: [], pages: "active", events: [] }),
      ),
    ),
    call("AgentPlanRunRepository.create", (world) =>
      insertRun(
        world,
        runFixture("run-access", PLAN.id, {
          status: "succeeded",
          steps: [
            stepFixture("review", {
              execution: remoteExecutionFixture("run-access", PLAN.id),
            }),
          ],
        }),
      ),
    ),
    call("AgentPlanRemoteAccessRepository.write", ({ database }) =>
      new AgentPlanRemoteAccessRepository(database).write(
        "run-access",
        ATTEMPT,
        () => ({ files: [], pages: "closed", events: [] }),
      ),
    ),
    call("AgentPlanRunRepository.find", ({ database }) =>
      new AgentPlanRunRepository(database).find("run-access"),
    ),
  ],
};

/** The refused starts of a plan, per person. */
export const START_REJECTION_FLOW: RepositoryFlow = {
  title: "plan start rejections",
  steps: [
    call("AgentPlanStartRejectionRepository.latest", (world) =>
      rejections(world).latest(OWNER, "plan-rejected"),
    ),
    call("AgentPlanStartRejectionRepository.page", (world) =>
      rejections(world).page(OWNER, "plan-rejected", null),
    ),
    call("AgentPlanStartRejectionRepository.append", (world) =>
      rejections(world).append(OWNER, "plan-rejected", REJECTION),
    ),
    call("AgentPlanStartRejectionRepository.append", (world) =>
      rejections(world).append(
        OWNER,
        "plan-rejected",
        { ...REJECTION, id: "rejection-2" },
        () => Promise.resolve(),
      ),
    ),
    call("AgentPlanStartRejectionRepository.append", (world) =>
      rejections(world).append(OTHER_USER, "plan-rejected", {
        ...REJECTION,
        id: "rejection-3",
      }),
    ),
    reversedInPostgres("agent_plan_start_rejections"),
    call("AgentPlanStartRejectionRepository.latest", (world) =>
      rejections(world).latest(OWNER, "plan-rejected"),
    ),
    call("AgentPlanStartRejectionRepository.page", (world) =>
      rejections(world).page(OWNER, "plan-rejected", null),
    ),
    call("AgentPlanStartRejectionRepository.page", (world) =>
      rejections(world).page(OWNER, "plan-rejected", "rejection-2"),
    ),
    call("AgentPlanStartRejectionRepository.page", (world) =>
      rejections(world).page(OWNER, "plan-rejected", "rejection-1"),
    ),
    call("AgentPlanStartRejectionRepository.page", (world) =>
      rejections(world).page(OWNER, "plan-rejected", "rejection-3"),
    ),
    refused("AgentPlanStartRejectionRepository.append", (world) =>
      rejections(world).append(OWNER, "plan-rejected", REJECTION),
    ),
    refused("AgentPlanStartRejectionRepository.append", (world) =>
      rejections(world).append(
        OWNER,
        "plan-rejected",
        { ...REJECTION, id: "rejection-4" },
        () => Promise.reject(new Error("The flow ends this journal.")),
      ),
    ),
    stored(
      "SELECT COUNT(*) FROM agent_plan_start_rejections WHERE id = 'rejection-4';",
    ),
  ],
};

/** The report slot of a running turn. */
export const STEP_REPORT_FLOW: RepositoryFlow = {
  title: "plan step reports",
  steps: [
    call("AgentPlanStepReportRepository.find", (world) =>
      reports(world).find(REPORT_SLOT),
    ),
    call("AgentPlanStepReportRepository.save", (world) =>
      reports(world).save(REPORT_SLOT, '{"report":0}'),
    ),
    call("AgentPlanStepReportRepository.close", (world) =>
      reports(world).close(REPORT_SLOT),
    ),
    call("AgentPlanStepReportRepository.open", (world) =>
      reports(world).open(REPORT_SLOT),
    ),
    call("AgentPlanStepReportRepository.find", (world) =>
      reports(world).find(REPORT_SLOT),
    ),
    call("AgentPlanStepReportRepository.save", (world) =>
      reports(world).save(REPORT_SLOT, '{"report":1}'),
    ),
    call("AgentPlanStepReportRepository.save", (world) =>
      reports(world).save({ ...REPORT_SLOT, attemptId: "attempt-other" }, "{}"),
    ),
    call("AgentPlanStepReportRepository.open", (world) =>
      reports(world).open({ ...REPORT_SLOT, termsJson: '{"terms":2}' }),
    ),
    call("AgentPlanStepReportRepository.find", (world) =>
      reports(world).find(REPORT_SLOT),
    ),
    call("AgentPlanStepReportRepository.open", (world) =>
      reports(world).open({ ...REPORT_SLOT, attemptId: "attempt-2" }),
    ),
    call("AgentPlanStepReportRepository.find", (world) =>
      reports(world).find(REPORT_SLOT),
    ),
    call("AgentPlanStepReportRepository.close", (world) =>
      reports(world).close(REPORT_SLOT),
    ),
    call("AgentPlanStepReportRepository.save", (world) =>
      reports(world).save(
        { ...REPORT_SLOT, attemptId: "attempt-2" },
        '{"r":2}',
      ),
    ),
    call("AgentPlanStepReportRepository.close", (world) =>
      reports(world).close({ ...REPORT_SLOT, attemptId: "attempt-2" }),
    ),
    call("AgentPlanStepReportRepository.find", (world) =>
      reports(world).find(REPORT_SLOT),
    ),
    refused("AgentPlanStepReportRepository.open", (world) =>
      reports(world).open({ ...REPORT_SLOT, termsJson: MISSING_TEXT }),
    ),
  ],
};

/** The evidence of the work of an attempt. */
export const PLAN_WORK_FLOW: RepositoryFlow = {
  title: "plan work",
  steps: [
    call("AgentPlanWorkRepository.basis", ({ database }) =>
      new AgentPlanWorkRepository(database).basis("run-missing"),
    ),
    call("AgentPlanRunRepository.create", (world) =>
      insertRun(
        world,
        runFixture("run-work", PLAN.id, { status: "succeeded" }),
      ),
    ),
    call("AgentPlanWorkRepository.basis", ({ database }) =>
      new AgentPlanWorkRepository(database).basis("run-work"),
    ),
    call("AgentPlanWorkRepository.find", ({ database }) =>
      new AgentPlanWorkRepository(database).find(WORK_KEY),
    ),
    call("AgentPlanWorkRepository.insert", ({ database }) =>
      new AgentPlanWorkRepository(database).insert(WORK_KEY, WORK_RECORD),
    ),
    call("AgentPlanWorkRepository.insert", ({ database }) =>
      new AgentPlanWorkRepository(database).insert(WORK_KEY, {
        ...WORK_RECORD,
        revision: 2,
        note: "Nachgetragen",
      }),
    ),
    reversedInPostgres("agent_plan_work"),
    call("AgentPlanWorkRepository.find", ({ database }) =>
      new AgentPlanWorkRepository(database).find(WORK_KEY),
    ),
    refused("AgentPlanWorkRepository.insert", ({ database }) =>
      new AgentPlanWorkRepository(database).insert(WORK_KEY, WORK_RECORD),
    ),
    refusedWithoutTable(
      "AgentPlanWorkRepository.basis",
      "agent_plan_runs",
      (transaction) =>
        new AgentPlanWorkRepository(transaction).basis("run-work"),
    ),
  ],
};

/** Metadata-only fixtures; these values never authorize a native process. */
const OWNER_RUN = "10000000-0000-4000-8000-000000000001";
const OWNER_INSTANCE = "10000000-0000-4000-8000-000000000002";
const OWNER_STEP = "10000000-0000-4000-8000-000000000003";
const OWNER_ATTEMPT = "10000000-0000-4000-8000-000000000004";
const OWNER_PLAN = planFixture("plan-owner-check");
const OWNER_PROOF = {
  instanceKey: "synthetic-owner-key",
  instanceId: OWNER_INSTANCE,
  runId: OWNER_RUN,
  stepId: OWNER_STEP,
  attemptId: OWNER_ATTEMPT,
  unit: `pages-local-${OWNER_INSTANCE}.service`,
  invocationId: "0".repeat(32),
  boot: "10000000-0000-4000-8000-000000000005",
  uid: 1000,
  pid: 123,
  start: 1,
  cgroup: "/synthetic-not-a-process",
  arguments: [],
};

async function verifyLocalOwnerPersistence({
  database,
}: RepositoryWorld): Promise<void> {
  const owners = new LocalSessionRepository(database);
  await owners.create({
    instanceId: OWNER_INSTANCE,
    instanceKey: OWNER_PROOF.instanceKey,
    runId: OWNER_RUN,
    stepId: OWNER_STEP,
    attemptId: OWNER_ATTEMPT,
    manifestDigest: "0".repeat(64),
  });
  const [entry] = await owners.list(OWNER_PROOF.instanceKey);
  assert.ok(entry);
  assert.equal(entry.proof, null);
  await owners.prove(OWNER_INSTANCE, OWNER_PROOF);
  await owners.prove(OWNER_INSTANCE, OWNER_PROOF);
  await assert.rejects(
    owners.prove(OWNER_INSTANCE, { ...OWNER_PROOF, pid: 124 }),
  );
  const reference = await requireAgentFiles(database).write(
    OWNER_PLAN.id,
    "{}",
  );
  assert.equal(await owners.result(OWNER_INSTANCE, "missing"), null);
  await owners.saveResult(OWNER_INSTANCE, "turn", reference);
  await owners.saveResult(OWNER_INSTANCE, "turn", reference);
  assert.equal(await owners.result(OWNER_INSTANCE, "turn"), reference);
  await owners.claim(OWNER_INSTANCE, "first");
  await owners.requireImporter(entry, "first");
  await owners.claim(OWNER_INSTANCE, "second");
  await assert.rejects(owners.requireImporter(entry, "first"));
  const next = {
    sequence: 1,
    digest: "digest-1",
    checkpointFile: reference,
    token: "second",
  };
  await owners.acknowledge(entry, next);
  await assert.rejects(owners.acknowledge(entry, next));
  await owners.released(OWNER_INSTANCE);
  const [saved] = await owners.list(OWNER_PROOF.instanceKey);
  assert.ok(saved);
  assert.equal(saved.acknowledgedSequence, 1);
  assert.deepEqual(saved.proof, OWNER_PROOF);
  assert.ok(saved.releasedAt);
}

async function verifyCommandPersistence({
  database,
}: RepositoryWorld): Promise<void> {
  const commands = new PlanRunCommandRepository(database);
  assert.equal(await commands.latest(OWNER_RUN), null);
  assert.equal(await commands.hasAccepted(), false);
  assert.equal(await commands.snapshot(OWNER_PLAN.id, undefined), null);
  assert.equal(await commands.readSnapshot(null), undefined);
  const snapshot = snapshotFixture(OWNER_PLAN);
  const reference = await commands.snapshot(OWNER_PLAN.id, snapshot);
  assert.deepEqual(await commands.readSnapshot(reference), snapshot);
  const receipt = commands.receipt(OWNER_RUN, "pause");
  await database.transaction((transaction) =>
    commands.insert(transaction, receipt, reference),
  );
  assert.equal(await commands.hasAccepted(), true);
  const [pending] = await commands.pending();
  assert.equal(pending?.receipt.id, receipt.id);
  await database.transaction((transaction) =>
    commands.applied(transaction, receipt.id),
  );
  assert.equal((await commands.latest(OWNER_RUN))?.status, "applied");
  await commands.delivered(receipt.id);
  assert.deepEqual(await commands.pending(), []);
  const failed = commands.receipt(OWNER_RUN, "stop");
  await database.transaction((transaction) =>
    commands.insert(transaction, failed),
  );
  await commands.failed(failed.id, "synthetic refusal");
  assert.equal((await commands.latest(OWNER_RUN))?.status, "failed");
  assert.equal(await commands.hasAccepted(), false);
  const cleanup = new RunApiCleanupRepository(database);
  const item = {
    runId: OWNER_RUN,
    stepId: OWNER_STEP,
    attemptId: OWNER_ATTEMPT,
  };
  await cleanup.enqueue(item);
  await cleanup.enqueue(item);
  assert.deepEqual(await cleanup.pending(), [item]);
  await cleanup.complete(item.attemptId);
  assert.deepEqual(await cleanup.pending(), []);
}

/** Exercises the new durable metadata contracts within the existing PostgreSQL flow. */
export const RUN_OWNERSHIP_FLOW: RepositoryFlow = {
  title: "durable run ownership and commands",
  steps: [
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(OWNER_PLAN, true),
    ),
    call("AgentPlanRunRepository.create", ({ database }) =>
      new AgentPlanRunRepository(database).create(
        runFixture(OWNER_RUN, OWNER_PLAN.id),
        snapshotFixture(OWNER_PLAN),
        [],
      ),
    ),
    call("LocalSessionRepository.create", verifyLocalOwnerPersistence),
    call("PlanRunCommandRepository.insert", verifyCommandPersistence),
    call("AcpResourceRepository.tryReserve", async ({ database }) => {
      const resources = new AcpResourceRepository(database);
      const record = {
        instanceId: "synthetic-reservation",
        userId: OWNER,
        provider: "codex_cli" as const,
        runId: null,
        stepId: null,
        state: "starting" as const,
        since: "2026-03-01T08:00:00.000Z",
      };
      assert.equal(await resources.tryReserve(record, 0), false);
      assert.equal(await resources.tryReserve(record, 1000), true);
      assert.equal(await resources.tryReserve(record, 1000), false);
      await resources.remove(record.instanceId);
    }),
    call("AgentPlanRunRepository.engineState", async ({ database }) => {
      const runs = new AgentPlanRunRepository(database);
      assert.equal(await runs.engineState(OWNER_RUN), undefined);
      assert.equal(await runs.engineState("missing-engine"), undefined);
    }),
    call("PageAgentRunRepository.snapshotText", async ({ database }) => {
      const archive = new PageAgentRunRepository(database);
      const contents = JSON.stringify({ synthetic: "retained archive" });
      const reference = await requireAgentFiles(database).write(
        OWNER_PLAN.id,
        contents,
      );
      assert.equal(await archive.snapshotText(reference), contents);
      assert.equal(await archive.snapshotText(contents), contents);
    }),
    call("PlanRunOwnerRepository.acquire", ({ database, databaseUrl }) =>
      database.transaction(async (transaction) => {
        await transaction.query(
          "SELECT pg_advisory_xact_lock(1346455365, 226);",
        );
        const owner = new PlanRunOwnerRepository(databaseUrl, () => undefined);
        assert.equal(await owner.acquire(), false);
      }),
    ),
    call("prepareSessionHistoryChunks", ({ database }) =>
      prepareSessionHistoryChunks(database, OWNER_PLAN.id, []),
    ),
    call("prepareRunnerSessionEvents", ({ database }) =>
      prepareRunnerSessionEvents(database, {
        binding: RUNNER_BINDING,
        jobId: JOB_ID,
        events: [],
      }),
    ),
    call("readStoredEventRow", async ({ database }) => {
      const reference = await requireAgentFiles(database).write(
        OWNER_PLAN.id,
        "Retained file body",
      );
      const event = await readStoredEventRow(
        database,
        [
          1,
          1,
          "agent_message",
          "",
          0,
          "2026-03-01T08:00:00.000Z",
          OWNER_STEP,
          reference,
        ],
        OWNER_ATTEMPT,
      );
      assert.equal(event.text, "Retained file body");
    }),
  ],
};
