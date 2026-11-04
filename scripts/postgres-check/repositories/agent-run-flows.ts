import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import {
  findPlanResourceBlocker,
  reservePlanResources,
} from "@/backend/database/repositories/agent/AgentPlanResourceReservation";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";

import {
  OTHER_USER,
  OWNER,
  planFixture,
  runFixture,
  snapshotFixture,
} from "./plan-fixtures";
import { call, prepare, refused, reversedInPostgres, stored } from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";

const PLAN = planFixture("plan-runs", { name: "Läufe" });
const SECOND_PLAN = planFixture("plan-runs-second", { name: "Läufe 2" });
const SNAPSHOT = snapshotFixture(PLAN);
const SECOND_SNAPSHOT = snapshotFixture(SECOND_PLAN);
const RESOURCE = "remote-workspace:run-resource";

const RUN = runFixture("run-a", PLAN.id);

function runs({ database }: RepositoryWorld): AgentPlanRunRepository {
  return new AgentPlanRunRepository(database);
}

/** Starting a plan, reading its runs and the reservations of its directories. */
export const PLAN_RUN_FLOW: RepositoryFlow = {
  title: "plan runs",
  steps: [
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(PLAN, true),
    ),
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(SECOND_PLAN, true),
    ),
    call("AgentPlanRunRepository.latest", (world) =>
      runs(world).latest(PLAN.id),
    ),
    call("AgentPlanRunRepository.find", (world) => runs(world).find("run-a")),
    call("AgentPlanRunRepository.ownership", (world) =>
      runs(world).ownership("run-a"),
    ),
    refused("AgentPlanRunRepository.create", (world) =>
      runs(world).create({ ...RUN, planRevision: 9 }, SNAPSHOT, [RESOURCE]),
    ),
    call("AgentPlanRunRepository.create", (world) =>
      runs(world).create(RUN, SNAPSHOT, [RESOURCE], () => Promise.resolve()),
    ),
    refused("AgentPlanRunRepository.create", (world) =>
      runs(world).create(runFixture("run-a2", PLAN.id), SNAPSHOT, [
        "remote-workspace:another",
      ]),
    ),
    stored(
      "SELECT COUNT(*) FROM agent_plan_workspace_locks WHERE workspace_id = 'remote-workspace:another';",
    ),
    call("AgentPlanRunRepository.find", (world) => runs(world).find("run-a")),
    call("AgentPlanRunRepository.latest", (world) =>
      runs(world).latest(PLAN.id),
    ),
    call("AgentPlanRunRepository.ownership", (world) =>
      runs(world).ownership("run-a"),
    ),
    call("AgentPlanRunRepository.hasReservation", (world) =>
      runs(world).hasReservation("run-a"),
    ),
    call("AgentPlanRunRepository.hasReservation", (world) =>
      runs(world).hasReservation("run-none"),
    ),
    call("AgentPlanRunRepository.findWorkspaceReservation", (world) =>
      runs(world).findWorkspaceReservation([RESOURCE, "free"]),
    ),
    call("AgentPlanRunRepository.findWorkspaceReservation", (world) =>
      runs(world).findWorkspaceReservation([RESOURCE], "run-a"),
    ),
    call("AgentPlanRunRepository.insert", ({ database }) =>
      database.transaction((transaction) =>
        new AgentPlanRunRepository(database).insert(
          transaction,
          runFixture("run-second", SECOND_PLAN.id, {
            startedAt: "2026-03-01T07:00:00.000Z",
          }),
          SECOND_SNAPSHOT,
          [],
        ),
      ),
    ),
    call("AgentPlanRunRepository.reserve", (world) =>
      runs(world).reserve("run-second", ["remote-workspace:second"]),
    ),
    call("AgentPlanRunRepository.reserve", (world) =>
      runs(world).reserve("run-second", [RESOURCE]),
    ),
    call("reservePlanResources", ({ database }) =>
      database.transaction((transaction) =>
        reservePlanResources(transaction, "run-second", [
          "local-directory:/nonexistent/pages-216",
        ]),
      ),
    ),
    call("reservePlanResources", ({ database }) =>
      database.transaction((transaction) =>
        reservePlanResources(transaction, "run-third", [
          "local-directory:/nonexistent/pages-216/child",
        ]),
      ),
    ),
    stored(
      "SELECT workspace_id, run_id FROM agent_plan_workspace_locks WHERE run_id LIKE 'run-%' ORDER BY workspace_id;",
    ),
    prepare(`
      INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
      VALUES ('legacy-without-run', 'run-gone');
    `),
    refused("reservePlanResources", ({ database }) =>
      database.transaction((transaction) =>
        reservePlanResources(transaction, "run-new", ["remote-workspace:free"]),
      ),
    ),
    reversedInPostgres("agent_plan_workspace_locks"),
    call("reservePlanResources", ({ database }) =>
      database.transaction((transaction) =>
        reservePlanResources(transaction, "run-new", [RESOURCE]),
      ),
    ),
    refused("findPlanResourceBlocker", ({ database }) =>
      database.transaction((transaction) =>
        findPlanResourceBlocker(transaction, runFixture("run-new", PLAN.id), [
          "remote-workspace:free",
        ]),
      ),
    ),
    prepare(
      "DELETE FROM agent_plan_workspace_locks WHERE run_id = 'run-gone';",
    ),
    prepare(`
      INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
      VALUES ('legacy-with-run', 'run-second');
    `),
    call("AgentPlanRunRepository.resourceBlocker", (world) =>
      runs(world).resourceBlocker(runFixture("run-new", PLAN.id), [
        RESOURCE,
        "remote-workspace:second",
        "legacy-with-run",
      ]),
    ),
    reversedInPostgres("agent_plan_workspace_locks"),
    call("AgentPlanRunRepository.resourceBlocker", (world) =>
      runs(world).resourceBlocker(runFixture("run-new", PLAN.id), [
        RESOURCE,
        "remote-workspace:second",
        "legacy-with-run",
      ]),
    ),
    call("AgentPlanRunRepository.resourceBlocker", (world) =>
      runs(world).resourceBlocker(runFixture("run-new", PLAN.id), [RESOURCE]),
    ),
    call("AgentPlanRunRepository.resourceBlocker", (world) =>
      runs(world).resourceBlocker(
        runFixture("run-new", PLAN.id, { userId: OTHER_USER }),
        [RESOURCE, "remote-workspace:second"],
      ),
    ),
    call("AgentPlanRunRepository.resourceBlocker", (world) =>
      runs(world).resourceBlocker(runFixture("run-new", PLAN.id), [
        "remote-workspace:free",
      ]),
    ),
    call("AgentPlanRunRepository.resourceBlocker", (world) =>
      runs(world).resourceBlocker(runFixture("run-new", PLAN.id), []),
    ),
    call("findPlanResourceBlocker", ({ database }) =>
      database.transaction((transaction) =>
        findPlanResourceBlocker(transaction, runFixture("run-new", PLAN.id), [
          RESOURCE,
        ]),
      ),
    ),
    call("AgentPlanRunRepository.resources", (world) =>
      runs(world).resources("run-a"),
    ),
    refused("AgentPlanRunRepository.resources", (world) =>
      runs(world).resources("run-missing"),
    ),
    call("AgentPlanRunRepository.snapshot", (world) =>
      runs(world).snapshot("run-a"),
    ),
    call("AgentPlanRunRepository.snapshot", (world) =>
      runs(world).snapshot("run-missing"),
    ),
    call("AgentPlanRunRepository.stepAgent", (world) =>
      runs(world).stepAgent("run-a", "review"),
    ),
    call("AgentPlanRunRepository.stepAgent", (world) =>
      runs(world).stepAgent("run-a", "step-missing"),
    ),
    reversedInPostgres("agent_plan_runs"),
    call("AgentPlanRunRepository.unfinished", (world) =>
      runs(world).unfinished(),
    ),
    call("AgentPlanRunRepository.active", (world) => runs(world).active(OWNER)),
    call("AgentPlanRunRepository.active", (world) =>
      runs(world).active(OTHER_USER),
    ),
    call("AgentPlanRunRepository.latestOwn", (world) =>
      runs(world).latestOwn(OWNER),
    ),
    call("AgentPlanRunRepository.latestOwn", (world) =>
      runs(world).latestOwn(OTHER_USER),
    ),
    prepare(`
      INSERT INTO agent_plan_runs (id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json)
      SELECT
          'run-many-' || CAST(number AS TEXT),
          'plan-many-' || CAST(number AS TEXT),
          'user-many',
          'p',
          'w',
          '2026-03-01',
          'failed',
          '{}',
          '{}'
      FROM generate_series(1, 9) AS numbers(number);
    `),
    reversedInPostgres("agent_plan_runs"),
    call("AgentPlanRunRepository.latestOwn", (world) =>
      runs(world).latestOwn("user-many"),
    ),
    prepare("DELETE FROM agent_plan_runs WHERE user_id = 'user-many';"),
    call("AgentPlanRunRepository.list", (world) =>
      runs(world).list(OWNER, PLAN.id),
    ),
    call("AgentPlanRunRepository.entries", (world) =>
      runs(world).entries(OWNER, PLAN.id, "newest"),
    ),
    call("AgentPlanRunRepository.entries", (world) =>
      runs(world).entries(OWNER, PLAN.id, "oldest"),
    ),
    prepare(
      "UPDATE agent_plan_runs SET status = 'exploded' WHERE id = 'run-second';",
    ),
    refused("AgentPlanRunRepository.latestOwn", (world) =>
      runs(world).latestOwn(OWNER),
    ),
    prepare(
      "UPDATE agent_plan_runs SET status = 'running' WHERE id = 'run-second';",
    ),
    call("AgentPlanRunRepository.release", (world) =>
      runs(world).release("run-a"),
    ),
    call("AgentPlanRunRepository.hasReservation", (world) =>
      runs(world).hasReservation("run-a"),
    ),
    call("AgentPlanRunRepository.reserving", (world) =>
      runs(world).reserving(),
    ),
    prepare(
      `
      UPDATE agent_plan_runs
      SET status = 'failed', view_json = $view
      WHERE id = 'run-second';
    `,
      {
        view: JSON.stringify(
          runFixture("run-second", SECOND_PLAN.id, {
            status: "failed",
            startedAt: "2026-03-01T07:00:00.000Z",
            recovery: {
              state: "interrupted",
              requiresReconciliation: false,
              automaticResume: { state: "pending" },
            },
          }),
        ),
      },
    ),
    call("AgentPlanRunRepository.reserving", (world) =>
      runs(world).reserving(),
    ),
    prepare(
      `
      INSERT INTO agent_plan_runs (id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json)
      VALUES ('run-pending-earlier', 'plan-pending', 'user-plan-owner', 'p', 'w', '2026-03-01T06:00:00.000Z', 'failed', $view, '{}');
    `,
      {
        view: JSON.stringify(
          runFixture("run-pending-earlier", "plan-pending", {
            status: "failed",
            recovery: {
              state: "interrupted",
              requiresReconciliation: false,
              automaticResume: { state: "pending" },
            },
          }),
        ),
      },
    ),
    prepare(`
      INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
      VALUES ('reserved-by-earlier', 'run-pending-earlier');
    `),
    call("AgentPlanRunRepository.reserving", (world) =>
      runs(world).reserving(),
    ),
    call("AgentPlanRunRepository.pendingAutomaticResumes", (world) =>
      runs(world).pendingAutomaticResumes(),
    ),
    reversedInPostgres("agent_plan_runs"),
    call("AgentPlanRunRepository.reserving", (world) =>
      runs(world).reserving(),
    ),
    call("AgentPlanRunRepository.pendingAutomaticResumes", (world) =>
      runs(world).pendingAutomaticResumes(),
    ),
    prepare(
      "DELETE FROM agent_plan_workspace_locks WHERE run_id = 'run-pending-earlier';",
    ),
    prepare("DELETE FROM agent_plan_runs WHERE id = 'run-pending-earlier';"),
    call("AgentPlanRunRepository.release", (world) =>
      runs(world).release("run-second"),
    ),
    call("AgentPlanRunRepository.hasReservation", (world) =>
      runs(world).hasReservation("run-second"),
    ),
    prepare(`
      INSERT INTO agent_plan_runs (id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json)
      VALUES ('run-damaged', 'plan-damaged', 'user-plan-owner', 'p', 'w', '2026-01-01', 'running', 'kein JSON', 'kein JSON');
    `),
    call("AgentPlanRunRepository.pendingAutomaticResumes", (world) =>
      runs(world).pendingAutomaticResumes(),
    ),
    refused("AgentPlanRunRepository.find", (world) =>
      runs(world).find("run-damaged"),
    ),
    call("AgentPlanRunRepository.ownership", (world) =>
      runs(world).ownership("run-damaged"),
    ),
    refused("AgentPlanRunRepository.resources", (world) =>
      runs(world).resources("run-damaged"),
    ),
    refused("AgentPlanRunRepository.unfinished", (world) =>
      runs(world).unfinished(),
    ),
    prepare(
      "UPDATE agent_plan_runs SET plan_id = 'plan-runs-second', status = 'failed' WHERE id = 'run-damaged';",
    ),
    refused("AgentPlanRunRepository.pendingAutomaticResumes", (world) =>
      runs(world).pendingAutomaticResumes(),
    ),
    call("AgentPlanRunRepository.list", (world) =>
      runs(world).list(OWNER, SECOND_PLAN.id),
    ),
    prepare("DELETE FROM agent_plan_runs WHERE id = 'run-damaged';"),
    prepare(
      `
      UPDATE agent_plan_runs
      SET status = 'failed', view_json = $view
      WHERE id = 'run-second';
    `,
      {
        view: JSON.stringify(
          runFixture("run-second", SECOND_PLAN.id, {
            status: "failed",
            startedAt: "2026-03-01T07:00:00.000Z",
          }),
        ),
      },
    ),
    call("AgentPlanRunRepository.pendingAutomaticResumes", (world) =>
      runs(world).pendingAutomaticResumes(),
    ),
  ],
};
