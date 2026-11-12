import { strict as assert } from "node:assert";

import { AgentPlanAccessRepository } from "@/backend/database/repositories/agent/AgentPlanAccessRepository";
import { AgentPlanAuditRepository } from "@/backend/database/repositories/agent/AgentPlanAuditRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanScriptApprovalRepository } from "@/backend/database/repositories/agent/AgentPlanScriptApprovalRepository";
import {
  requirePlanConnections,
  requireRemotePlanModels,
} from "@/backend/database/repositories/agent/AgentPlanStoredReferences";
import {
  AgentPlanTeamRepository,
  readAllPlanTeams,
  readPlanTeams,
} from "@/backend/database/repositories/agent/AgentPlanTeamRepository";
import { fullPlanTeam } from "@/definition/AgentPlanTeam";

import { OTHER_USER, OWNER, planFixture } from "./plan-fixtures";
import { call, refused } from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";

const DEPARTMENT = "department-teams";
const OTHER_DEPARTMENT = "department-teams-other";
const GROUP = "group-teams";
const FIRST_TEAM = fullPlanTeam("department", DEPARTMENT);
const PLAN = planFixture("plan-teams", {
  name: "Team",
  departmentId: DEPARTMENT,
  teams: [FIRST_TEAM],
});
/** A plan of the other department with the same name, for the name space. */
const NAMESAKE = planFixture("plan-teams-namesake", {
  name: "Team",
  departmentId: OTHER_DEPARTMENT,
  teams: [fullPlanTeam("department", OTHER_DEPARTMENT)],
});
const READING_GROUP: AgentPlanTeam = {
  kind: "group",
  targetId: GROUP,
  canRead: true,
  canEdit: false,
  canRun: false,
};
const HASH = "c".repeat(64);

function access({ database }: RepositoryWorld): AgentPlanAccessRepository {
  return new AgentPlanAccessRepository(database);
}

function audit({ database }: RepositoryWorld): AgentPlanAuditRepository {
  return new AgentPlanAuditRepository(database);
}

function approvals({
  database,
}: RepositoryWorld): AgentPlanScriptApprovalRepository {
  return new AgentPlanScriptApprovalRepository(database);
}

async function expectTeams(
  world: RepositoryWorld,
  expected: readonly AgentPlanTeam[],
): Promise<readonly AgentPlanTeam[]> {
  const teams = await readPlanTeams(world.database, PLAN.id);
  assert.deepEqual(teams, expected);
  const plan = await new AgentPlanRepository(world.database).find(PLAN.id);
  assert.deepEqual(plan?.teams, expected);
  return teams;
}

async function expectActions(
  world: RepositoryWorld,
  expected: readonly string[],
): Promise<readonly string[]> {
  const entries = await audit(world).list(PLAN.id, 50);
  const actions = entries.map((entry) => entry.action).sort();
  assert.deepEqual(actions, [...expected].sort());
  return actions;
}

/**
 * The teams, the owner, the script approvals and the history of a plan (PAGE-329).
 *
 * @remarks
 * A new plan stores its first team; an access change is a revision of its own,
 * refused for a stale revision or a name the new team already uses, and every
 * change lands in the history in the same commit.
 */
export const PLAN_TEAM_FLOW: RepositoryFlow = {
  title: "plan teams, owner and history",
  steps: [
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(PLAN, true),
    ),
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(NAMESAKE, true),
    ),
    call("readPlanTeams", (world) => expectTeams(world, [FIRST_TEAM])),
    call("readAllPlanTeams", async ({ database }) => {
      const all = await readAllPlanTeams(database);
      assert.deepEqual(all.get(PLAN.id), [FIRST_TEAM]);
      return [...all.keys()].filter((id) => id.startsWith("plan-teams"));
    }),
    call("AgentPlanAccessRepository.change", async (world) => {
      const revision = await access(world).change({
        planId: PLAN.id,
        revision: 1,
        actorId: OWNER,
        teams: [FIRST_TEAM, READING_GROUP],
      });
      assert.equal(revision, 2);
      return expectTeams(world, [FIRST_TEAM, READING_GROUP]);
    }),
    refused("AgentPlanAccessRepository.change", (world) =>
      access(world).change({
        planId: PLAN.id,
        revision: 1,
        actorId: OWNER,
        teams: [],
      }),
    ),
    refused("AgentPlanAccessRepository.change", (world) =>
      access(world).change({
        planId: PLAN.id,
        revision: 2,
        actorId: OWNER,
        teams: [fullPlanTeam("department", OTHER_DEPARTMENT)],
      }),
    ),
    call("AgentPlanAccessRepository.change", async (world) => {
      const revision = await access(world).change({
        planId: PLAN.id,
        revision: 2,
        actorId: OTHER_USER,
        ownerId: OTHER_USER,
      });
      assert.equal(revision, 3);
      const plan = await new AgentPlanRepository(world.database).find(PLAN.id);
      assert.equal(plan?.ownerId, OTHER_USER);
      assert.equal(plan?.revision, 3);
      return expectActions(world, ["teams_changed", "owner_changed"]);
    }),
    call("AgentPlanTeamRepository.replace", (world) =>
      new AgentPlanTeamRepository(world.database).replace(PLAN.id, [
        READING_GROUP,
        FIRST_TEAM,
      ]),
    ),
    call("readPlanTeams", (world) =>
      expectTeams(world, [READING_GROUP, FIRST_TEAM]),
    ),
    call("AgentPlanScriptApprovalRepository.list", async (world) => {
      const stored = await approvals(world).list(PLAN.id);
      assert.equal(stored.size, 0);
      return stored.size;
    }),
    refused("AgentPlanAccessRepository.approveScripts", (world) =>
      access(world).approveScripts({
        planId: PLAN.id,
        revision: 2,
        actorId: OWNER,
        approvals: [{ stepId: "review", contentHash: HASH }],
      }),
    ),
    call("AgentPlanAccessRepository.approveScripts", async (world) => {
      await access(world).approveScripts({
        planId: PLAN.id,
        revision: 3,
        actorId: OWNER,
        approvals: [{ stepId: "review", contentHash: HASH }],
      });
      const stored = await approvals(world).list(PLAN.id);
      assert.equal(stored.get("review")?.contentHash, HASH);
      assert.equal(stored.get("review")?.approvedBy, OWNER);
      return stored.size;
    }),
    call("AgentPlanScriptApprovalRepository.approve", async (world) => {
      await approvals(world).approve(PLAN.id, {
        stepId: "review",
        contentHash: "d".repeat(64),
        approvedBy: OTHER_USER,
      });
      const stored = await approvals(world).list(PLAN.id);
      assert.equal(stored.size, 1);
      assert.equal(stored.get("review")?.approvedBy, OTHER_USER);
      return stored.size;
    }),
    call("AgentPlanAccessRepository.record", (world) =>
      access(world).record({
        planId: PLAN.id,
        actorId: OWNER,
        action: "admin_saved",
        revision: 3,
      }),
    ),
    call("AgentPlanAuditRepository.append", (world) =>
      audit(world).append({
        planId: PLAN.id,
        actorId: OWNER,
        action: "admin_started",
        revision: 3,
        details: { runId: "run-teams" },
      }),
    ),
    call("AgentPlanAuditRepository.list", (world) =>
      expectActions(world, [
        "teams_changed",
        "owner_changed",
        "script_approved",
        "admin_saved",
        "admin_started",
      ]),
    ),
    call("requirePlanConnections", ({ database }) =>
      database.transaction((transaction) =>
        requirePlanConnections(transaction, PLAN),
      ),
    ),
    call("requireRemotePlanModels", ({ database }) =>
      database.transaction((transaction) =>
        requireRemotePlanModels(transaction, PLAN),
      ),
    ),
    call("AgentPlanRepository.remove", async (world) => {
      await new AgentPlanRepository(world.database).remove(NAMESAKE.id, OWNER);
      // The trigger of the migration removes the teams with the plan.
      const teams = await readPlanTeams(world.database, NAMESAKE.id);
      assert.deepEqual(teams, []);
      return teams;
    }),
  ],
};
