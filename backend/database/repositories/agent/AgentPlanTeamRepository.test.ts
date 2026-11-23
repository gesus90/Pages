import { expect, it, vi } from "vitest";

import {
  AgentPlanTeamRepository,
  readAllPlanTeams,
  readPlanTeams,
} from "./AgentPlanTeamRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

it("reads the teams of every plan grouped in stored order", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [
    ["p1", "group", "g1", 1, 0, 0],
    ["p1", "user", "u1", 1, 1, 1],
    ["p2", "department", "d1", 1, 0, 1],
  ]);

  const teams = await readAllPlanTeams({ query });

  expect(teams.get("p1")).toEqual([
    {
      kind: "group",
      targetId: "g1",
      canRead: true,
      canEdit: false,
      canRun: false,
    },
    {
      kind: "user",
      targetId: "u1",
      canRead: true,
      canEdit: true,
      canRun: true,
    },
  ]);
  expect(teams.get("p2")?.[0]).toMatchObject({
    kind: "department",
    canEdit: false,
  });
});

it("reads the teams of one plan", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [
    ["p1", "group", "g1", 1, 1, 0],
  ]);

  const teams = await readPlanTeams({ query }, "p1");

  expect(query.mock.calls[0]?.[1]).toEqual({ plan_id: "p1" });
  expect(teams).toHaveLength(1);
});

it("refuses a stored team of an unknown kind", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [
    ["p1", "robot", "g1", 1, 1, 0],
  ]);

  await expect(readPlanTeams({ query }, "p1")).rejects.toMatchObject({
    code: "plan_invalid",
  });
});

it("replaces the teams in their order", async () => {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const repository = new AgentPlanTeamRepository({ execute, query: vi.fn() });

  await repository.replace("p1", [
    {
      kind: "group",
      targetId: "g1",
      canRead: true,
      canEdit: true,
      canRun: false,
    },
    {
      kind: "user",
      targetId: "u1",
      canRead: true,
      canEdit: false,
      canRun: true,
    },
  ]);

  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[0]?.[1]).toEqual({ plan_id: "p1" });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    plan_id: "p1",
    position: 0,
    kind: "group",
    target_id: "g1",
    can_read: true,
    can_edit: true,
    can_run: false,
  });
  expect(execute.mock.calls[2]?.[1]).toMatchObject({
    position: 1,
    kind: "user",
  });
});

it("clears the teams for an empty list", async () => {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});

  await new AgentPlanTeamRepository({ execute, query: vi.fn() }).replace(
    "p1",
    [],
  );

  expect(execute).toHaveBeenCalledTimes(1);
});
