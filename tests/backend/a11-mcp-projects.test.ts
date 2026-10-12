import { expect, it, vi } from "vitest";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";

import { a11Fetch, callA11Tool, useA11McpHarness } from "../helpers/a11-mcp";
import { pageInput } from "../helpers/wiki-harness";

const setup = useA11McpHarness();

it("rolls back data and project activity together when the replay record fails", async () => {
  const harness = await setup();
  const before = await harness.database.query(
    "SELECT COUNT(*) FROM project_activity;",
  );
  const failure = new Error("Replay storage failed");
  vi.spyOn(
    AgentOperationKeyRepository.prototype,
    "insert",
  ).mockRejectedValueOnce(failure);
  await expect(
    harness.services.pagesAgentApiService.handle(harness.configuration.token, {
      operation: "projects.setName",
      parameters: {
        operationId: "rollback",
        projectId: "p1",
        name: "Uncommitted",
      },
    }),
  ).rejects.toBe(failure);
  expect(
    await harness.database.query("SELECT name FROM projects WHERE id = $id;", {
      id: "p1",
    }),
  ).toEqual([["Project p1"]]);
  expect(
    await harness.database.query("SELECT COUNT(*) FROM project_activity;"),
  ).toEqual(before);
});

it("refreshes account rights for every call and treats personal administrators independently of browser mode", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const authorization = new AuthorizationRepository(harness.database);
  const account = (await authorization.snapshot()).accounts.find(
    ({ userId }) => userId === "owner",
  );
  if (!account) throw new Error("Missing owner account");
  await authorization.saveAccount({ ...account, mode: "role" });
  const input = {
    operationId: "role-mode",
    projectId: "p1",
    name: "Administrator",
  };
  expect(
    await callA11Tool(harness.connection, "set_project_name", input),
  ).toMatchObject({ changed: true });
  const manager = (await authorization.snapshot()).accounts.find(
    ({ userId }) => userId === "manager",
  );
  if (!manager) throw new Error("Missing manager account");
  if (!manager.role) throw new Error("Missing manager role");
  await authorization.saveRole({ ...manager.role, permissions: [] });
  harness.configuration.token = harness.tokens.get("manager") ?? "";
  expect(
    await callA11Tool(harness.connection, "set_project_name", {
      ...input,
      operationId: "revoked",
      name: "Denied",
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  expect(
    await harness.database.query("SELECT name FROM projects WHERE id = $id;", {
      id: "p1",
    }),
  ).toEqual([["Administrator"]]);
});

it.each([
  {
    name: "set_project_name",
    arguments: { name: "Renamed" },
    column: "name",
    expected: "Renamed",
  },
  {
    name: "set_project_description",
    arguments: { description: "Description" },
    column: "description",
    expected: "Description",
  },
  {
    name: "set_project_status",
    arguments: { status: "active" },
    column: "status",
    expected: "active",
  },
  {
    name: "set_project_dates",
    arguments: { startDate: "2026-10-11", targetDate: "2026-10-12" },
    column: "start_date",
    expected: "2026-10-11",
  },
])(
  "applies $name with the UI rights and refuses readers without changing activity",
  async ({ name, arguments: parameters, column, expected }) => {
    const harness = await setup();
    vi.stubGlobal("fetch", a11Fetch(harness));
    expect(
      await callA11Tool(harness.connection, name, {
        operationId: name,
        projectId: "p1",
        ...parameters,
      }),
    ).toMatchObject({ changed: true });
    expect(
      await harness.database.query(
        `SELECT ${column} FROM projects WHERE id = $id;`,
        { id: "p1" },
      ),
    ).toEqual([[expected]]);
    const before = await harness.database.query(
      "SELECT COUNT(*) FROM project_activity;",
    );
    harness.configuration.token = harness.tokens.get("reader") ?? "";
    expect(
      await callA11Tool(harness.connection, name, {
        operationId: `denied-${name}`,
        projectId: "p1",
        ...parameters,
      }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await harness.database.query("SELECT COUNT(*) FROM project_activity;"),
    ).toEqual(before);
  },
);

it("creates projects using department-scoped management, replays once, and has no project deletion operation", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const input = {
    operationId: "project-create",
    name: "New",
    description: "Description",
    status: "planned",
    departmentIds: ["alpha"],
  };
  harness.configuration.token = harness.tokens.get("writer") ?? "";
  expect(
    await callA11Tool(harness.connection, "create_project", input),
  ).toMatchObject({ code: "FORBIDDEN" });
  harness.configuration.token = harness.tokens.get("manager") ?? "";
  const authorization = new AuthorizationRepository(harness.database);
  const managerRole = (await authorization.snapshot()).accounts.find(
    ({ userId }) => userId === "manager",
  )?.role;
  if (!managerRole) throw new Error("Missing manager role");
  await authorization.saveRole({
    ...managerRole,
    permissions: managerRole.permissions.filter(
      (permission) => permission !== "write",
    ),
  });
  const result = await callA11Tool(harness.connection, "create_project", input);
  expect(result.id).toEqual(expect.any(String));
  expect(
    await callA11Tool(harness.connection, "create_project", input),
  ).toEqual(result);
  expect(
    await callA11Tool(harness.connection, "create_project", {
      ...input,
      operationId: "outside",
      departmentIds: ["beta"],
    }),
  ).toMatchObject({ code: "INVALID_REQUEST" });
  const listed = await harness.connection.request("tools/list");
  expect(JSON.stringify(listed)).not.toContain('"delete_project"');
  await expect(
    harness.services.pagesAgentApiService.handle(harness.configuration.token, {
      operation: "projects.delete",
      parameters: { projectId: result.id },
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

it("assigns and removes visible people, groups and departments, while preserving rights and privacy", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const input = {
    operationId: "person",
    projectId: "p1",
    targetType: "person",
    targetId: "writer",
    role: "member",
  };
  expect(
    await callA11Tool(harness.connection, "assign_project_member", input),
  ).toMatchObject({ affectedCount: 1 });
  expect(
    await callA11Tool(harness.connection, "assign_project_member", {
      ...input,
      operationId: "group",
      targetType: "group",
      targetId: "visible-group",
    }),
  ).toMatchObject({ affectedCount: 1 });
  expect(
    await callA11Tool(harness.connection, "assign_project_member", {
      ...input,
      operationId: "department",
      targetType: "department",
      targetId: "beta",
    }),
  ).toMatchObject({ changed: true });
  harness.configuration.token = harness.tokens.get("reader") ?? "";
  expect(
    await callA11Tool(harness.connection, "assign_project_member", {
      ...input,
      operationId: "denied",
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  expect(
    await callA11Tool(harness.connection, "remove_project_member", {
      operationId: "denied-remove",
      projectId: "p1",
      targetType: "person",
      targetId: "writer",
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  harness.configuration.token = harness.tokens.get("owner") ?? "";
  for (const [targetType, targetId] of [
    ["group", "visible-group"],
    ["department", "beta"],
    ["person", "writer"],
  ])
    expect(
      await callA11Tool(harness.connection, "remove_project_member", {
        operationId: `remove-${targetType}`,
        projectId: "p1",
        targetType,
        targetId,
      }),
    ).toMatchObject({ changed: true });
  harness.configuration.token = harness.tokens.get("manager") ?? "";
  expect(
    await callA11Tool(harness.connection, "assign_project_member", {
      ...input,
      operationId: "invisible",
      targetId: "hidden",
    }),
  ).toMatchObject({ code: "NOT_FOUND" });
});

it("pages every directory and project read without exposing hidden profiles, page activity or counts", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  await harness.service.create(
    harness.owner,
    pageInput({
      title: "Secret activity",
      projectId: "p1",
      scope: "project",
      anchors: [{ kind: "department", targetId: "beta" }],
    }),
  );
  harness.configuration.token = harness.tokens.get("writer") ?? "";
  for (const name of [
    "list_departments",
    "list_groups",
    "list_visible_people",
  ]) {
    const result = await callA11Tool(harness.connection, name, { limit: 1 });
    expect(JSON.stringify(result)).not.toMatch(
      /Hidden|hidden-group|"email"|"password"|"username"/,
    );
    if (result.nextCursor !== null) {
      const next = await callA11Tool(harness.connection, name, {
        limit: 1,
        cursor: result.nextCursor,
      });
      expect(next).not.toEqual(result);
    }
    expect(
      await callA11Tool(harness.connection, name, { cursor: "bad" }),
    ).toMatchObject({ code: "INVALID_REQUEST" });
  }
  const members = await callA11Tool(
    harness.connection,
    "read_project_members",
    { projectId: "p1", limit: 1 },
  );
  expect(JSON.stringify(members)).not.toMatch(/Hidden|"email"|"username"/);
  expect(
    await callA11Tool(harness.connection, "read_project_activity", {
      projectId: "p1",
    }),
  ).toMatchObject({ entries: [], total: 0 });
  await new ProjectRepository(harness.database).insertActivity({
    id: "past-actor",
    projectId: "p1",
    userId: "hidden",
    category: "project",
    action: "project_updated",
    message: "Project details were updated.",
  });
  const activity = await callA11Tool(
    harness.connection,
    "read_project_activity",
    { projectId: "p1" },
  );
  expect(activity).toMatchObject({ total: 1, entries: [{ id: "past-actor" }] });
  expect(JSON.stringify(activity)).not.toMatch(
    /Hidden|"hidden"|"actor"|"userId"|"userDisplayName"/,
  );
  for (const name of [
    "read_project_members",
    "read_project_activity",
    "list_project_tickets",
  ])
    expect(
      await callA11Tool(harness.connection, name, { projectId: "p2" }),
    ).toMatchObject({ code: "NOT_FOUND" });
});
