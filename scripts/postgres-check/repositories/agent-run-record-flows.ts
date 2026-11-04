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
