import { beforeEach, expect, it, vi } from "vitest";

import {
  AgentPlanAccessRepository,
  writePlanAccess,
} from "./AgentPlanAccessRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";

const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
const query = vi.fn<DatabaseTransaction["query"]>();
const transaction: DatabaseTransaction = { execute, query };

const TEAMS: readonly AgentPlanTeam[] = [
  {
    kind: "group",
    targetId: "g1",
    canRead: true,
    canEdit: true,
    canRun: false,
  },
  {
    kind: "department",
    targetId: "d1",
    canRead: true,
    canEdit: true,
    canRun: true,
  },
];

function repositoryFailingWith(error: unknown): AgentPlanAccessRepository {
  const database: Pick<Database, "transaction"> = {
    transaction: async () => {
      throw error;
    },
  };
  return new AgentPlanAccessRepository(database);
}

function repository(): AgentPlanAccessRepository {
  return new AgentPlanAccessRepository({
    transaction: async (work) => work(transaction),
  });
}

function lockedPlan(revision: number): void {
  query.mockResolvedValueOnce([[revision, "owner", "My Plan"]]);
}

function executedActions(): unknown[] {
  return execute.mock.calls.map((call) => call[1]?.action).filter(Boolean);
}

beforeEach(() => {
  execute.mockClear();
  query.mockReset();
});

it("writes teams and a new owner as one revision with two history entries", async () => {
  lockedPlan(4);
  const journal = vi.fn(async () => {});

  const revision = await repository().change({
    planId: "p1",
    revision: 4,
    actorId: "admin",
    ownerId: "new-owner",
    teams: TEAMS,
    journal,
  });

  expect(revision).toBe(5);
  expect(executedActions()).toEqual(["teams_changed", "owner_changed"]);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    id: "p1",
    department_id: "d1",
    name_key: "my plan",
  });
  expect(
    execute.mock.calls.some((call) => call[1]?.owner_id === "new-owner"),
  ).toBe(true);
  expect(
    execute.mock.calls.some((call) => call[1]?.updated_by === "admin"),
  ).toBe(true);
  expect(journal).toHaveBeenCalledWith(transaction);
  expect(execute.mock.calls.at(-1)?.[1]).toMatchObject({
    channel: "pages_live_changes",
  });
});

it("leaves owner and teams alone when the change names neither", async () => {
  lockedPlan(1);

  expect(
    await writePlanAccess(transaction, {
      planId: "p1",
      revision: 1,
      actorId: "u",
      ownerId: "owner",
    }),
  ).toBe(2);
  expect(executedActions()).toEqual([]);
});

it("refuses a stale revision and a missing plan", async () => {
  lockedPlan(9);
  query.mockResolvedValueOnce([]);

  await expect(
    repository().change({ planId: "p1", revision: 1, actorId: "u" }),
  ).rejects.toMatchObject({ code: "plan_conflict" });
  await expect(
    repository().change({ planId: "p1", revision: 1, actorId: "u" }),
  ).rejects.toMatchObject({ code: "plan_conflict" });
});

it("translates a name collision into plan_name_taken", async () => {
  const violation = Object.assign(new Error("duplicate"), {
    code: "23505",
    detail: "Key (project_id, name_key)=(a, b) already exists.",
  });

  await expect(
    repositoryFailingWith(violation).change({
      planId: "p1",
      revision: 1,
      actorId: "u",
    }),
  ).rejects.toMatchObject({ code: "plan_name_taken" });
  await expect(
    repositoryFailingWith(new Error("UNIQUE constraint violation")).change({
      planId: "p1",
      revision: 1,
      actorId: "u",
    }),
  ).rejects.toMatchObject({ code: "plan_name_taken" });
});

it("passes other failures through", async () => {
  const failure = new Error("disk");

  await expect(
    repositoryFailingWith(failure).change({
      planId: "p1",
      revision: 1,
      actorId: "u",
    }),
  ).rejects.toBe(failure);
  await expect(
    repositoryFailingWith("text").change({
      planId: "p1",
      revision: 1,
      actorId: "u",
    }),
  ).rejects.toBe("text");
});

it("approves every script step and records it", async () => {
  lockedPlan(2);

  await repository().approveScripts({
    planId: "p1",
    revision: 2,
    actorId: "admin",
    approvals: [
      { stepId: "s1", contentHash: "h1" },
      { stepId: "s2", contentHash: "h2" },
    ],
  });

  expect(executedActions()).toEqual(["script_approved", "script_approved"]);
  expect(
    execute.mock.calls.filter((call) => call[1]?.approved_by === "admin"),
  ).toHaveLength(2);
});

it("refuses an approval for a stale revision", async () => {
  lockedPlan(3);

  await expect(
    repository().approveScripts({
      planId: "p1",
      revision: 2,
      actorId: "admin",
      approvals: [],
    }),
  ).rejects.toMatchObject({ code: "plan_conflict" });
});

it("records a history entry in a transaction of its own", async () => {
  await repository().record({
    planId: "p1",
    actorId: "u",
    action: "admin_saved",
    revision: 1,
  });

  expect(executedActions()).toEqual(["admin_saved"]);
});
