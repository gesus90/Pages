import {
  findPlanResourceBlocker,
  reservePlanResources,
} from "@/backend/database/repositories/agent/AgentPlanResourceReservation";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";

import { runFixture } from "./plan-fixtures";
import { inOrder } from "./saved-order-flows";
import { call, prepare, refused, reversedInPostgres } from "./world";

import type { RepositoryFlow, RepositoryStep } from "./world";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const CREATED = ["order-run-z", "order-run-m", "order-run-a"];
const RESOURCE_Z = "remote-workspace:order-z";
const RESOURCE_A = "remote-workspace:order-a";

function insertedRun(
  id: string,
  startedAt: string,
  view: unknown,
): RepositoryStep {
  return prepare(
    `
    INSERT INTO agent_plan_runs (id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json)
    VALUES ($id, $plan, 'user-order', 'p', 'w', $started_at, 'running', $view, '{"plan":{"id":"p","nodes":[],"edges":[]},"steps":[]}');
  `,
    {
      id,
      plan: `plan-${id}`,
      started_at: startedAt,
      view: JSON.stringify(view),
    },
  );
}

/** Reads a list of runs in both physical orders; an index read backwards undoes a reversal. */
function createdFirst(
  name: string,
  read: (runs: AgentPlanRunRepository) => Promise<readonly AgentPlanRun[]>,
): readonly RepositoryStep[] {
  const step = call(name, async ({ database }) =>
    inOrder(
      (await read(new AgentPlanRunRepository(database))).filter((run) =>
        CREATED.includes(run.id),
      ),
      CREATED,
      (run) => run.id,
    ),
  );
  return [step, reversedInPostgres("agent_plan_runs"), step];
}

/**
 * The orders that decide something: runs as created, a holder with a run before one
 * without, the first created holder. `reserving` had no order of its own before.
 */
export const AGENT_ORDER_FLOW: RepositoryFlow = {
  title: "agent order",
  steps: [
    prepare("DELETE FROM agent_plan_workspace_locks;"),
    // Times and identifiers run against the creation, so only the creation can sort them.
    ...CREATED.map((id, index) =>
      insertedRun(
        id,
        `2026-03-0${String(3 - index)}T08:00:00.000Z`,
        runFixture(id, `plan-${id}`, { steps: [] }),
      ),
    ),
    ...createdFirst("AgentPlanRunRepository.unfinished", (runs) =>
      runs.unfinished(),
    ),
    // A later write of the first run does not move it.
    prepare(`
      UPDATE agent_plan_runs
      SET recovery_revision = recovery_revision + 1
      WHERE id = 'order-run-z';
    `),
    ...createdFirst("AgentPlanRunRepository.unfinished", (runs) =>
      runs.unfinished(),
    ),
    ...CREATED.map((id) =>
      prepare(
        `
        UPDATE agent_plan_runs
        SET status = 'failed', view_json = $view
        WHERE id = $id;
      `,
        {
          id,
          view: JSON.stringify(
            runFixture(id, `plan-${id}`, {
              status: "failed",
              steps: [],
              recovery: {
                state: "interrupted",
                requiresReconciliation: false,
                automaticResume: { state: "pending" },
              },
            }),
          ),
        },
      ),
    ),
    ...createdFirst("AgentPlanRunRepository.pendingAutomaticResumes", (runs) =>
      runs.pendingAutomaticResumes(),
    ),
    prepare(`
      INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
      VALUES
          ('order-reserved-z', 'order-run-a'),
          ('order-reserved-m', 'order-run-m'),
          ('order-reserved-a', 'order-run-z');
    `),
    ...createdFirst("AgentPlanRunRepository.reserving", (runs) =>
      runs.reserving(),
    ),
    prepare("DELETE FROM agent_plan_workspace_locks;"),
    // The old case: a reservation without a run or snapshot, created before a real holder.
    prepare(`
      INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
      VALUES
          ('order-legacy', 'order-run-gone'),
          ('${RESOURCE_Z}', 'order-run-m'),
          ('${RESOURCE_A}', 'order-run-z');
    `),
    reversedInPostgres("agent_plan_workspace_locks"),
    call("reservePlanResources", async ({ database }) =>
      inOrder(
        [
          await database.transaction((transaction) =>
            reservePlanResources(transaction, "order-run-new", [RESOURCE_A]),
          ),
        ],
        [false],
      ),
    ),
    call("findPlanResourceBlocker", async ({ database }) => {
      const blocker = await database.transaction((transaction) =>
        findPlanResourceBlocker(
          transaction,
          runFixture("order-run-new", "plan-order"),
          [RESOURCE_A, RESOURCE_Z],
        ),
      );
      // The holder created first is named, not the alphabetically first one.
      return inOrder([blocker?.resource], [RESOURCE_Z]);
    }),
    prepare(`
      DELETE FROM agent_plan_workspace_locks
      WHERE workspace_id IN ('${RESOURCE_Z}', '${RESOURCE_A}');
    `),
    // Without a real holder the old reservation still refuses, as before.
    refused("reservePlanResources", ({ database }) =>
      database.transaction((transaction) =>
        reservePlanResources(transaction, "order-run-new", [RESOURCE_A]),
      ),
    ),
    prepare("DELETE FROM agent_plan_workspace_locks;"),
    prepare("DELETE FROM agent_plan_runs WHERE id LIKE 'order-run-%';"),
  ],
};
