import { expect, it } from "vitest";

import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";

import { scriptedDatabase } from "../scripted-database";

function row(
  overrides: Record<number, string | number | null> = {},
): (string | number | null)[] {
  const values: (string | number | null)[] = [
    "plan-1",
    "owner-1",
    "project-1",
    "workspace-1",
    "department-1",
    "Release",
    "workspace",
    4,
    null,
  ];
  for (const [index, value] of Object.entries(overrides))
    values[Number(index)] = value;
  return values;
}

it("lists the identity and sharing of every plan in one query that never selects the graph", async () => {
  const script = scriptedDatabase();
  script.answer([
    row(),
    row({
      0: "plan-2",
      4: null,
      6: "private",
      8: JSON.stringify({
        isGlobal: false,
        operator: "and",
        targets: [{ kind: "group", targetId: "group-1" }],
      }),
    }),
  ]);

  const listings = await new AgentPlanRepository(script.database).listings();

  expect(listings).toEqual([
    {
      id: "plan-1",
      ownerId: "owner-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      departmentId: "department-1",
      name: "Release",
      usage: "workspace",
      revision: 4,
    },
    {
      id: "plan-2",
      ownerId: "owner-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      departmentId: null,
      name: "Release",
      usage: "private",
      revision: 4,
      sharing: {
        isGlobal: false,
        operator: "and",
        targets: [{ kind: "group", targetId: "group-1" }],
      },
    },
  ]);
  expect(script.statements).toHaveLength(1);
  const [{ statement }] = script.statements;
  expect(statement).toContain("FROM agent_plans");
  expect(statement).toContain("ORDER BY lower(name), id");
  expect(statement).not.toMatch(/^\s*plan_json,?\s*$/mu);
});

it("refuses a plan whose usage or sharing is not one the editor knows", async () => {
  const script = scriptedDatabase();
  script.answer([row({ 6: "public" })]);
  await expect(
    new AgentPlanRepository(script.database).listings(),
  ).rejects.toMatchObject({ code: "plan_invalid" });

  script.answer([row({ 8: JSON.stringify({ isGlobal: "yes", targets: [] }) })]);
  await expect(
    new AgentPlanRepository(script.database).listings(),
  ).rejects.toMatchObject({ code: "plan_invalid" });
});
