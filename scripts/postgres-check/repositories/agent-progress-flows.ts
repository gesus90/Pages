import { AgentPlanContinuationRepository } from "@/backend/database/repositories/agent/AgentPlanContinuationRepository";
import { AgentPlanProgressRepository } from "@/backend/database/repositories/agent/AgentPlanProgressRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { retireRestartSource } from "@/backend/database/repositories/agent/AgentPlanResourceReservation";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";

import {
  checkpointFixture,
  planFixture,
  remoteExecutionFixture,
  runFixture,
  sessionFixture,
  snapshotFixture,
  stepFixture,
  WORKSPACE,
} from "./plan-fixtures";
import { call, prepare, refused, stored } from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const PLAN = planFixture("plan-runs", { name: "Läufe" });
const SNAPSHOT = snapshotFixture(PLAN);
const PAUSE_BOUNDARY = {
  pausedAt: "2026-03-01T08:30:00.000Z",
  completedStepIds: [],
  pendingStepIds: ["review"],
  frontierStepIds: ["review"],
};

const RUN = runFixture("run-a", PLAN.id);
const PAUSED: AgentPlanRun = {
  ...RUN,
  status: "paused",
  pauseBoundary: PAUSE_BOUNDARY,
};
const SUCCEEDED: AgentPlanRun = {
  ...RUN,
  status: "succeeded",
  endedAt: "2026-03-01T09:00:00.000Z",
  steps: [stepFixture("review", { status: "succeeded", output: "done" })],
};

function runs({ database }: RepositoryWorld): AgentPlanRunRepository {
  return new AgentPlanRunRepository(database);
}

function progress({ database }: RepositoryWorld): AgentPlanProgressRepository {
  return new AgentPlanProgressRepository(database);
}

function continuations({
  database,
}: RepositoryWorld): AgentPlanContinuationRepository {
  return new AgentPlanContinuationRepository(database);
}

/** Progress of a run: completions, stops, retirement and new bases. */
export const PLAN_PROGRESS_FLOW: RepositoryFlow = {
  title: "plan progress",
  steps: [
    refused("AgentPlanRunRepository.update", (world) =>
      runs(world).update(runFixture("run-missing", PLAN.id)),
    ),
    refused("AgentPlanRunRepository.update", (world) =>
      runs(world).update({
        ...RUN,
        steps: [stepFixture("review", { status: "succeeded", output: "done" })],
      }),
    ),
    call("AgentPlanRunRepository.update", (world) =>
      runs(world).update(
        {
          ...RUN,
          steps: [
            stepFixture("review", { status: "succeeded", output: "done" }),
          ],
        },
        checkpointFixture(
          {
            ...RUN,
            steps: [
              stepFixture("review", { status: "succeeded", output: "done" }),
            ],
          },
          SNAPSHOT,
        ),
        undefined,
        () => Promise.resolve(),
      ),
    ),
    stored(
      "SELECT status, recovery_revision FROM agent_plan_runs WHERE id = 'run-a';",
    ),
    stored(
      "SELECT version, step_id, run_revision FROM agent_plan_checkpoints WHERE run_id = 'run-a';",
    ),
    call("AgentPlanProgressRepository.update", (world) =>
      progress(world).update({
        ...RUN,
        stopRequested: true,
        steps: [stepFixture("review", { status: "succeeded", output: "done" })],
      }),
    ),
    call("AgentPlanRunRepository.find", (world) => runs(world).find("run-a")),
    refused("AgentPlanProgressRepository.update", (world) =>
      progress(world).update({
        ...RUN,
        steps: [
          stepFixture("review", { status: "succeeded", output: "other" }),
        ],
      }),
    ),
    call("AgentPlanProgressRepository.persist", ({ database }) =>
      database.transaction((transaction) =>
        new AgentPlanProgressRepository(database).persist(transaction, {
          ...SUCCEEDED,
          stopRequested: true,
        }),
      ),
    ),
    stored(
      "SELECT status, recovery_revision FROM agent_plan_runs WHERE id = 'run-a';",
    ),
    refused("AgentPlanProgressRepository.persist", ({ database }) =>
      database.transaction((transaction) =>
        new AgentPlanProgressRepository(database).persist(
          transaction,
          runFixture("run-missing", PLAN.id),
        ),
      ),
    ),
    call("AgentPlanRunRepository.interrupt", (world) =>
      runs(world).interrupt({ ...SUCCEEDED, status: "failed" }),
    ),
    call("AgentPlanRunRepository.find", (world) => runs(world).find("run-a")),
    call("AgentPlanProgressRepository.interrupt", (world) =>
      progress(world).interrupt({ ...SUCCEEDED, status: "failed" }),
    ),
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(
        planFixture("plan-progress", { name: "Fortschritt" }),
        true,
      ),
    ),
    call("AgentPlanRunRepository.create", (world) =>
      runs(world).create(
        runFixture("run-remote", "plan-progress", {
          steps: [
            stepFixture("review", {
              status: "failed",
              error: "plan_step_failed",
            }),
          ],
        }),
        snapshotFixture(planFixture("plan-progress")),
        ["remote-workspace:progress"],
      ),
    ),
    refused("AgentPlanRunRepository.resetRemoteRetry", (world) =>
      runs(world).resetRemoteRetry("run-remote", "review", sessionFixture()),
    ),
    refused("AgentPlanProgressRepository.resetRemoteRetry", (world) =>
      progress(world).resetRemoteRetry(
        "run-remote",
        "review",
        sessionFixture(),
      ),
    ),
    prepare(
      "UPDATE agent_plan_runs SET view_json = $view WHERE id = 'run-remote';",
      {
        view: JSON.stringify(
          runFixture("run-remote", "plan-progress", {
            steps: [
              stepFixture("review", {
                status: "failed",
                error: "plan_step_failed",
                execution: remoteExecutionFixture(
                  "run-remote",
                  "plan-progress",
                ),
              }),
            ],
          }),
        ),
      },
    ),
    call("AgentPlanRunRepository.resetRemoteRetry", (world) =>
      runs(world).resetRemoteRetry("run-remote", "review", sessionFixture()),
    ),
    call("AgentPlanProgressRepository.resetRemoteRetry", (world) =>
      progress(world).resetRemoteRetry(
        "run-remote",
        "review",
        sessionFixture(),
      ),
    ),
    call("AgentPlanRunRepository.find", (world) =>
      runs(world).find("run-remote"),
    ),
    call("AgentPlanProgressRepository.interrupt", (world) =>
      progress(world).interrupt(
        runFixture("run-remote", "plan-progress", {
          status: "failed",
          steps: [
            stepFixture("review", {
              status: "failed",
              error: "plan_step_failed",
            }),
          ],
        }),
      ),
    ),
    stored(
      "SELECT status, recovery_revision FROM agent_plan_runs WHERE id = 'run-remote';",
    ),
    call("AgentPlanRunRepository.hasReservation", (world) =>
      runs(world).hasReservation("run-remote"),
    ),
    call("retireRestartSource", ({ database }) =>
      database.transaction((transaction) =>
        retireRestartSource(transaction, runFixture("run-plain", PLAN.id)),
      ),
    ),
    call("retireRestartSource", ({ database }) =>
      database.transaction((transaction) =>
        retireRestartSource(
          transaction,
          runFixture("run-restart", "plan-progress", {
            origin: {
              kind: "restart",
              runId: "run-remote",
              mode: null,
              checkpointVersion: null,
              reusedStepIds: [],
              retriedStepIds: [],
              reviewedStepIds: [],
              requestedAt: "2026-03-01T10:00:00.000Z",
            },
          }),
        ),
      ),
    ),
    stored(
      "SELECT workspace_id, run_id, owner_id, removed_by, workspace_name, state, blocker FROM agent_workspace_cleanup WHERE run_id = 'run-remote';",
    ),
    refused("retireRestartSource", ({ database }) =>
      database.transaction((transaction) =>
        retireRestartSource(
          transaction,
          runFixture("run-restart", "plan-other", {
            origin: {
              kind: "restart",
              runId: "run-remote",
              mode: null,
              checkpointVersion: null,
              reusedStepIds: [],
              retriedStepIds: [],
              reviewedStepIds: [],
              requestedAt: "2026-03-01T10:00:00.000Z",
            },
          }),
        ),
      ),
    ),
    prepare(
      `
      INSERT INTO agent_plan_runs (id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json)
      VALUES ('run-retired', 'plan-progress', 'user-plan-owner', 'project-plans', $workspace, '2026-03-01', 'running', $view, $snapshot);
    `,
      {
        workspace: WORKSPACE,
        view: JSON.stringify(
          runFixture("run-retired", "plan-progress", {
            steps: [stepFixture("review")],
          }),
        ),
        snapshot: JSON.stringify(snapshotFixture(planFixture("plan-progress"))),
      },
    ),
    call("retireRestartSource", ({ database }) =>
      database.transaction((transaction) =>
        retireRestartSource(
          transaction,
          runFixture("run-restart", "plan-progress", {
            origin: {
              kind: "restart",
              runId: "run-retired",
              mode: null,
              checkpointVersion: null,
              reusedStepIds: [],
              retriedStepIds: [],
              reviewedStepIds: [],
              requestedAt: "2026-03-01T10:00:00.000Z",
            },
          }),
        ),
      ),
    ),
    call("AgentPlanRunRepository.find", (world) =>
      runs(world).find("run-retired"),
    ),
  ],
};

/** A paused run that adopts a new plan revision, and its bases. */
export const PLAN_CONTINUATION_FLOW: RepositoryFlow = {
  title: "plan continuations",
  steps: [
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(
        planFixture("plan-continued", { name: "Fortgesetzt" }),
        true,
      ),
    ),
    call("AgentPlanRunRepository.create", (world) =>
      runs(world).create(
        runFixture("run-continued", "plan-continued"),
        snapshotFixture(planFixture("plan-continued")),
        [],
      ),
    ),
    prepare(
      "UPDATE agent_plan_runs SET status = 'paused', view_json = $view WHERE id = 'run-continued';",
      {
        view: JSON.stringify({
          ...PAUSED,
          id: "run-continued",
          planId: "plan-continued",
          planName: "Plan plan-continued",
        }),
      },
    ),
    call("AgentPlanContinuationRepository.snapshotTexts", (world) =>
      continuations(world).snapshotTexts("run-continued"),
    ),
    call("AgentPlanContinuationRepository.snapshots", (world) =>
      continuations(world).snapshots("run-continued"),
    ),
    refused("AgentPlanContinuationRepository.adopt", (world) =>
      continuations(world).adopt({
        previous: runFixture("run-continued", "plan-continued"),
        run: runFixture("run-continued", "plan-continued"),
        snapshot: snapshotFixture(planFixture("plan-continued")),
        workspaceIds: [],
      }),
    ),
    call("AgentPlanContinuationRepository.adopt", async (world) => {
      const previous = {
        ...PAUSED,
        id: "run-continued",
        planId: "plan-continued",
        planName: "Plan plan-continued",
      };
      await continuations(world).adopt(
        {
          previous,
          run: {
            ...previous,
            status: "running",
            pauseBoundary: undefined,
            continuation: {
              version: 1,
              planRevision: 1,
              adoptedAt: "2026-03-01T11:00:00.000Z",
            },
          },
          snapshot: {
            ...snapshotFixture(planFixture("plan-continued")),
            steps: [],
          },
          workspaceIds: ["continued-a", "continued-b", "continued-a"],
        },
        () => Promise.resolve(),
      );
    }),
    stored(
      "SELECT run_id, version, plan_revision, adopted_at FROM agent_plan_continuations WHERE run_id = 'run-continued';",
    ),
    stored(
      "SELECT workspace_id FROM agent_plan_workspace_locks WHERE run_id = 'run-continued' ORDER BY workspace_id;",
    ),
    call("AgentPlanContinuationRepository.snapshotTexts", (world) =>
      continuations(world).snapshotTexts("run-continued"),
    ),
    call("AgentPlanRunRepository.snapshot", (world) =>
      runs(world).snapshot("run-continued"),
    ),
    call("AgentPlanRunRepository.update", (world) =>
      runs(world).update(
        runFixture("run-continued", "plan-continued", {
          status: "paused",
          pauseBoundary: PAUSE_BOUNDARY,
        }),
      ),
    ),
    refused("AgentPlanRunRepository.update", (world) =>
      runs(world).update(
        runFixture("run-continued", "plan-continued", { status: "running" }),
        undefined,
        {
          previous: runFixture("run-continued", "plan-continued"),
          snapshot: snapshotFixture(planFixture("plan-continued")),
          workspaceIds: [],
        },
      ),
    ),
  ],
};
