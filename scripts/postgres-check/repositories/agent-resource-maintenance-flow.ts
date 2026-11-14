import { strict as assert } from "node:assert";

import { AgentEnvironmentRepository } from "@/backend/database/repositories/agent/AgentEnvironmentRepository";
import { writePlanAccess } from "@/backend/database/repositories/agent/AgentPlanAccessRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanStartResourceRepository } from "@/backend/database/repositories/agent/AgentPlanStartResourceRepository";

import {
  OWNER,
  planFixture,
  runFixture,
  snapshotFixture,
  STARTED_AT,
} from "./plan-fixtures";
import { call, prepare } from "./world";

import type { RepositoryFlow } from "./world";

const PLAN = planFixture("plan-resource-check");
const RUN = runFixture("run-resource-check", PLAN.id);
const RESOURCE = "remote-workspace:resource-check";
const RELEASE = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: OWNER,
  targetRunId: RUN.id,
  createdAt: STARTED_AT,
  resources: [RESOURCE],
  processes: [],
  confirmed: true,
};

/** Checks resource conflicts, forced release and plan home maintenance. */
export const AGENT_RESOURCE_MAINTENANCE_FLOW: RepositoryFlow = {
  title: "resource maintenance",
  steps: [
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(PLAN, true),
    ),
    call("AgentPlanRepository.cloneSource", async ({ database }) => {
      assert.deepEqual(
        await new AgentPlanRepository(database).cloneSource(PLAN.id),
        PLAN,
      );
    }),
    call("AgentPlanRunRepository.create", ({ database }) =>
      new AgentPlanRunRepository(database).create(RUN, snapshotFixture(PLAN), [
        RESOURCE,
      ]),
    ),
    call(
      "AgentEnvironmentRepository.hasActiveWorkers",
      async ({ database }) => {
        assert.equal(
          await new AgentEnvironmentRepository(database).hasActiveWorkers(),
          false,
        );
      },
    ),
    call("AgentEnvironmentRepository.canRemoveRun", async ({ database }) => {
      assert.equal(
        await new AgentEnvironmentRepository(database).canRemoveRun(RUN.id),
        false,
      );
    }),
    call("AgentEnvironmentRepository.maintainPlan", async ({ database }) => {
      let disposition = "busy";
      await new AgentEnvironmentRepository(database).maintainPlan(
        PLAN.id,
        (result) => {
          disposition = result;
          return Promise.resolve();
        },
      );
      assert.equal(disposition, "busy");
    }),
    call("AgentPlanStartResourceRepository.conflicts", async ({ database }) => {
      const owners = await new AgentPlanStartResourceRepository(
        database,
      ).conflicts(PLAN.id, [RESOURCE]);
      assert.equal(owners.length, 1);
      assert.equal(owners[0]?.run.id, RUN.id);
      assert.deepEqual(owners[0]?.resources, [RESOURCE]);
    }),
    call(
      "AgentPlanStartResourceRepository.localOwners",
      async ({ database }) => {
        assert.deepEqual(
          await new AgentPlanStartResourceRepository(database).localOwners(
            RUN.id,
          ),
          [],
        );
      },
    ),
    call("AgentPlanStartResourceRepository.retire", async ({ database }) => {
      const run = await new AgentPlanStartResourceRepository(database).retire(
        RUN.id,
        RELEASE,
        { preserveRevision: false },
      );
      assert.equal(run.status, "cancelled");
      assert.equal(run.steps[0]?.status, "cancelled");
    }),
    call("AgentPlanStartResourceRepository.complete", async ({ database }) => {
      await new AgentPlanStartResourceRepository(database).complete(
        RUN.id,
        RELEASE,
        { preserveRevision: false },
      );
      assert.equal(
        await new AgentEnvironmentRepository(database).canRemoveRun(RUN.id),
        true,
      );
      let disposition = "busy";
      await new AgentEnvironmentRepository(database).maintainPlan(
        PLAN.id,
        (result) => {
          disposition = result;
          return Promise.resolve();
        },
      );
      assert.equal(disposition, "empty");
    }),
    call("writePlanAccess", async ({ database }) => {
      const revision = await database.transaction((transaction) =>
        writePlanAccess(transaction, {
          planId: PLAN.id,
          revision: 1,
          actorId: OWNER,
        }),
      );
      assert.equal(revision, 2);
    }),
    prepare("DELETE FROM agent_plan_runs WHERE id = 'run-resource-check';"),
    prepare("DELETE FROM agent_plans WHERE id = 'plan-resource-check';"),
  ],
};
