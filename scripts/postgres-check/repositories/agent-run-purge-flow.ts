import { strict as assert } from "node:assert";

import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import {
  purgeEarlierPlanRuns,
  queueEarlierRunPurge,
} from "@/backend/database/repositories/agent/AgentPlanRunPurge";

import { planFixture, runFixture, snapshotFixture } from "./plan-fixtures";
import { call, prepare, stored } from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";

const PLAN = planFixture("plan-purge", { name: "Bereinigung" });
const SNAPSHOT = snapshotFixture(PLAN);

function createRun(
  { database }: RepositoryWorld,
  runId: string,
): Promise<unknown> {
  return new AgentPlanRunRepository(database).create(
    runFixture(runId, PLAN.id),
    SNAPSHOT,
    [],
  );
}

async function purgeEarlierRuns(
  { database }: RepositoryWorld,
  isExpectedComplete: boolean,
): Promise<boolean> {
  const isComplete = await purgeEarlierPlanRuns(database, "run-purge-kept");
  assert.equal(isComplete, isExpectedComplete);
  return isComplete;
}

const REMAINING_RUNS = stored(
  "SELECT id, status FROM agent_plan_runs WHERE plan_id = 'plan-purge' ORDER BY creation_order, id;",
);

/** A new run of a plan removes the settled earlier runs and waits for the unsettled one. */
export const PLAN_RUN_PURGE_FLOW: RepositoryFlow = {
  title: "plan run purge",
  steps: [
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(PLAN, true),
    ),
    call("AgentPlanRunRepository.create", (world) =>
      createRun(world, "run-purge-settled"),
    ),
    prepare(
      "UPDATE agent_plan_runs SET status = 'succeeded' WHERE id = 'run-purge-settled';",
    ),
    call("AgentPlanRunRepository.create", (world) =>
      createRun(world, "run-purge-unsettled"),
    ),
    prepare(`
      UPDATE agent_plan_runs SET status = 'failed' WHERE id = 'run-purge-unsettled';
      INSERT INTO plan_run_api_cleanup (attempt_id, run_id, step_id)
      VALUES ('attempt-purge', 'run-purge-unsettled', 'review');
    `),
    call("AgentPlanRunRepository.create", (world) =>
      createRun(world, "run-purge-kept"),
    ),
    call("queueEarlierRunPurge", ({ database }) =>
      database.transaction((transaction) =>
        queueEarlierRunPurge(transaction, "run-purge-kept"),
      ),
    ),
    stored(
      "SELECT storage_name FROM agent_payload_garbage WHERE storage_name = 'plan-runs/run-purge-kept';",
    ),
    call("purgeEarlierPlanRuns", (world) => purgeEarlierRuns(world, false)),
    REMAINING_RUNS,
    prepare(
      "DELETE FROM plan_run_api_cleanup WHERE attempt_id = 'attempt-purge';",
    ),
    call("purgeEarlierPlanRuns", (world) => purgeEarlierRuns(world, true)),
    REMAINING_RUNS,
  ],
};
