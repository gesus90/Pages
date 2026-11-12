import { strict as assert } from "node:assert";

import { AgentPlanOneShotRepository } from "@/backend/database/repositories/agent/AgentPlanOneShotRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { purgeAllPlanRuns } from "@/backend/database/repositories/agent/AgentPlanRunPurge";

import {
  OWNER,
  planFixture,
  runFixture,
  snapshotFixture,
} from "./plan-fixtures";
import { call, prepare, refused, stored } from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";

const PLAN = planFixture("plan-once", { name: "Einmal", oneShot: true });
const KEPT = planFixture("plan-once-kept", { name: "Einmal B", oneShot: true });
const DEADLINE = "2026-03-01T08:05:00.000Z";
const BEFORE = "2026-03-01T08:04:59.000Z";

function oneShot({ database }: RepositoryWorld): AgentPlanOneShotRepository {
  return new AgentPlanOneShotRepository(database);
}

function plans({ database }: RepositoryWorld): AgentPlanRepository {
  return new AgentPlanRepository(database);
}

async function expectListing(
  world: RepositoryWorld,
  id: string,
  expected: { readonly oneShot: boolean; readonly deadline: string | null },
): Promise<unknown> {
  const listing = (await plans(world).listings()).find(
    (entry) => entry.id === id,
  );
  const plan = await plans(world).find(id);
  assert.equal(listing?.oneShot ?? false, expected.oneShot);
  assert.equal(plan?.oneShot ?? false, expected.oneShot);
  assert.equal(listing?.scheduledDeletionAt ?? null, expected.deadline);
  assert.equal(plan?.scheduledDeletionAt ?? null, expected.deadline);
  return { id, ...expected };
}

async function expectResult<Result>(
  run: Promise<Result>,
  expected: Result,
): Promise<Result> {
  const actual = await run;
  assert.deepEqual(actual, expected);
  return actual;
}

/** A one-time plan is scheduled after a successful run, kept on request and deleted with its runs and one log entry. */
export const PLAN_ONE_SHOT_FLOW: RepositoryFlow = {
  title: "one-time plans",
  steps: [
    call("AgentPlanRepository.save", (world) => plans(world).save(PLAN, true)),
    call("AgentPlanRepository.save", (world) => plans(world).save(KEPT, true)),
    call("AgentPlanRunRepository.create", ({ database }) =>
      new AgentPlanRunRepository(database).create(
        runFixture("run-once", PLAN.id),
        snapshotFixture(PLAN),
        [],
      ),
    ),
    call("AgentPlanOneShotRepository.schedule", (world) =>
      expectResult(oneShot(world).schedule(PLAN.id, DEADLINE), true),
    ),
    call("expectListing", (world) =>
      expectListing(world, PLAN.id, { oneShot: true, deadline: DEADLINE }),
    ),
    call("AgentPlanOneShotRepository.schedule", (world) =>
      expectResult(oneShot(world).schedule("plan-missing", DEADLINE), false),
    ),
    call("AgentPlanOneShotRepository.listDue", async (world) => {
      await expectResult(oneShot(world).listDue(BEFORE), []);
      return expectResult(oneShot(world).listDue(DEADLINE), [PLAN.id]);
    }),
    call("AgentPlanOneShotRepository.findCandidate", async (world) => {
      const candidate = await oneShot(world).findCandidate(PLAN.id);
      assert.equal(candidate?.isOneShot, true);
      assert.equal(candidate?.deletionAt, DEADLINE);
      assert.equal(candidate?.hasActiveRun, true);
      assert.equal(candidate?.latestRunStatus, "running");
      return candidate;
    }),
    prepare(
      "UPDATE agent_plan_runs SET status = 'succeeded' WHERE id = 'run-once';",
    ),
    call("AgentPlanOneShotRepository.findCandidate", async (world) => {
      const candidate = await oneShot(world).findCandidate(PLAN.id);
      assert.equal(candidate?.hasActiveRun, false);
      assert.equal(candidate?.latestRunStatus, "succeeded");
      return expectResult(oneShot(world).findCandidate("plan-missing"), null);
    }),
    call("AgentPlanOneShotRepository.deletePlan", (world) =>
      expectResult(oneShot(world).deletePlan(PLAN.id), "not_due"),
    ),
    call("purgeAllPlanRuns", ({ database }) =>
      expectResult(purgeAllPlanRuns(database, PLAN.id), true),
    ),
    stored("SELECT id FROM agent_plan_runs WHERE plan_id = 'plan-once';"),
    call("AgentPlanOneShotRepository.deletePlan", (world) =>
      expectResult(oneShot(world).deletePlan(PLAN.id), "deleted"),
    ),
    stored(
      "SELECT id FROM agent_plans WHERE id = 'plan-once' OR id = 'plan-once-kept' ORDER BY id;",
    ),
    stored(
      "SELECT user_id, category, action, message FROM project_activity WHERE action = 'one_shot_plan_deleted';",
    ),
    call("AgentPlanOneShotRepository.deletePlan", (world) =>
      expectResult(oneShot(world).deletePlan(PLAN.id), "gone"),
    ),
    call("AgentPlanOneShotRepository.schedule", (world) =>
      expectResult(oneShot(world).schedule(KEPT.id, DEADLINE), true),
    ),
    call("AgentPlanOneShotRepository.cancel", (world) =>
      oneShot(world).cancel(KEPT.id),
    ),
    call("expectListing", (world) =>
      expectListing(world, KEPT.id, { oneShot: true, deadline: null }),
    ),
    call("AgentPlanOneShotRepository.deletePlan", (world) =>
      expectResult(oneShot(world).deletePlan(KEPT.id), "not_due"),
    ),
    call("AgentPlanOneShotRepository.schedule", (world) =>
      expectResult(oneShot(world).schedule(KEPT.id, DEADLINE), true),
    ),
    refused("AgentPlanRepository.keepOneShot", (world) =>
      plans(world).keepOneShot(KEPT.id, { revision: 9, editorId: OWNER }),
    ),
    call("AgentPlanRepository.keepOneShot", (world) =>
      expectResult(
        plans(world).keepOneShot(KEPT.id, { revision: 1, editorId: OWNER }),
        true,
      ),
    ),
    call("expectListing", (world) =>
      expectListing(world, KEPT.id, { oneShot: false, deadline: null }),
    ),
    stored(
      "SELECT revision, plan_json FROM agent_plans WHERE id = 'plan-once-kept';",
    ),
    call("AgentPlanRepository.keepOneShot", (world) =>
      expectResult(
        plans(world).keepOneShot(KEPT.id, { revision: 2, editorId: OWNER }),
        false,
      ),
    ),
    call("AgentPlanRepository.save", (world) =>
      plans(world).save({ ...KEPT, oneShot: true, revision: 2 }, false),
    ),
    call("AgentPlanOneShotRepository.schedule", (world) =>
      expectResult(oneShot(world).schedule(KEPT.id, DEADLINE), true),
    ),
    call("AgentPlanRepository.save", (world) =>
      plans(world).save({ ...KEPT, oneShot: false, revision: 3 }, false),
    ),
    call("expectListing", (world) =>
      expectListing(world, KEPT.id, { oneShot: false, deadline: null }),
    ),
    call("AgentPlanRepository.remove", (world) =>
      plans(world).remove(KEPT.id, OWNER),
    ),
  ],
};
