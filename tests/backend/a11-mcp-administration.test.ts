import { describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentAdministrationService } from "@/backend/service/agents/AgentAdministrationService";
import {
  AGENT_ADMIN_READ_OPERATIONS,
  AGENT_ADMIN_WRITE_OPERATIONS,
  CHAT_ADMIN_WRITE_OPERATIONS,
} from "@/definition/AgentAdministration";
import { CAPABILITY } from "@/definition/Authorization";

import { a11Fetch, callA11Tool, useA11McpHarness } from "../helpers/a11-mcp";

const setup = useA11McpHarness();
type Harness = Awaited<ReturnType<ReturnType<typeof useA11McpHarness>>>;

async function api(
  run: Harness,
  operation: string,
  parameters: Readonly<Record<string, unknown>>,
  userId = "owner",
) {
  return run.services.pagesAgentApiService.handle(
    run.tokens.get(userId) ?? "",
    { operation, parameters },
  );
}

async function audit(run: Harness) {
  return new AdministrationActivityRepository(run.database).findAll();
}

async function account(run: Harness, userId: string) {
  const found = (
    await new AuthorizationRepository(run.database).snapshot()
  ).accounts.find((candidate) => candidate.userId === userId);
  if (!found) throw new Error("Missing fixture account.");
  return found;
}

describe("A11.6 AK-01: administrator reads through the real MCP transport", () => {
  it.each([
    ["list_admin_users", "admin.users.list", {}],
    ["list_admin_departments", "admin.departments.list", {}],
    ["list_admin_groups", "admin.groups.list", {}],
    ["list_admin_roles", "admin.roles.list", {}],
    ["list_admin_permissions", "admin.permissions.list", {}],
    [
      "read_admin_project_members",
      "admin.projectMembers.read",
      { projectId: "p2" },
    ],
    ["read_admin_activity", "admin.activity.read", {}],
  ])(
    "reads %s for an administrator and refuses a non-admin server-side",
    async (name, operation, parameters) => {
      const run = await setup();
      vi.stubGlobal("fetch", a11Fetch(run));
      expect(await callA11Tool(run.connection, name, parameters)).toBeTypeOf(
        "object",
      );
      for (const userId of ["writer", "manager", "reader"])
        await expect(
          api(run, operation, parameters, userId),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await audit(run)).toEqual([]);
    },
  );

  it("offers administrator tools only to personal admins, with no UI-mode change and no credentials in lists", async () => {
    const run = await setup();
    vi.stubGlobal("fetch", a11Fetch(run));
    const repository = new AuthorizationRepository(run.database);
    await repository.saveAccount({
      ...(await account(run, "owner")),
      mode: "role",
    });
    const verification = await api(run, "verify", {});
    expect(verification).toMatchObject({
      tools: expect.arrayContaining([
        ...AGENT_ADMIN_READ_OPERATIONS,
        ...AGENT_ADMIN_WRITE_OPERATIONS,
      ]),
    });
    const listed = await run.connection.request("tools/list");
    expect(JSON.stringify(listed)).toContain("list_admin_users");
    const people = await callA11Tool(run.connection, "list_admin_users", {
      limit: 2,
    });
    expect(people.entries).toHaveLength(2);
    expect(people.total).toBe(5);
    expect(people.nextCursor).toBeTypeOf("string");
    const next = await callA11Tool(run.connection, "list_admin_users", {
      cursor: people.nextCursor,
      limit: 2,
    });
    expect(next.entries).toHaveLength(2);
    const text = JSON.stringify([people, next]);
    for (const secret of ["password", "email", "hash", "token"])
      expect(text).not.toContain(secret);
    await expect(
      api(run, "admin.groups.list", { cursor: people.nextCursor }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await callA11Tool(run.connection, "rename_admin_department", {
      operationId: "role-mode",
      departmentId: "beta",
      expectedName: "Department beta",
      name: "Renamed beta",
    });
    expect((await account(run, "owner")).mode).toBe("role");
    run.configuration.token = run.tokens.get("manager") ?? "";
    expect(
      JSON.stringify(await run.connection.request("tools/list")),
    ).not.toContain("list_admin_users");
    expect(await api(run, "verify", {}, "manager")).toMatchObject({
      tools: expect.not.arrayContaining(["admin.users.list"]),
    });
  });

  it("ignores forged admin facts and checks persisted eligibility for every read and replay", async () => {
    const run = await setup();
    const service = new AgentAdministrationService(
      run.database,
      ServerCache.disabled(),
    );
    await expect(
      service.handle(
        {
          userId: "writer",
          isAdmin: true,
          permissions: Object.values(CAPABILITY),
        },
        "admin.users.list",
        {},
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const parameters = {
      operationId: "revoked-admin",
      departmentId: "beta",
      expectedName: "Department beta",
      name: "Changed",
    };
    await api(run, "admin.departments.rename", parameters);
    await new AuthorizationRepository(run.database).saveAccount({
      ...(await account(run, "owner")),
      isAdmin: false,
      mode: "role",
    });
    await expect(
      api(run, "admin.departments.rename", parameters),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api(run, "admin.users.list", {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await audit(run)).toHaveLength(1);
  });
});

describe("A11.6 AK-02: rights and existing memberships", () => {
  it("grants and revokes all configurable rights through an existing role, effective on the next call", async () => {
    const run = await setup();
    vi.stubGlobal("fetch", a11Fetch(run));
    const catalog = await callA11Tool(
      run.connection,
      "list_admin_permissions",
      {},
    );
    expect(catalog).toEqual({
      permissions: Object.values(CAPABILITY),
      read: true,
      canDisableRead: false,
    });
    const ticket = {
      operationId: "reader-ticket",
      projectId: "p1",
      type: "task",
      title: "New right",
      description: "",
      statusId: null,
      parentId: null,
      milestoneId: null,
    };
    await run.database.execute(
      "INSERT INTO project_keys (project_id, key) VALUES ('p1', 'ADMIN');",
    );
    await expect(
      api(run, "ticket.create", ticket, "reader"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const granted = {
      operationId: "grant-role",
      roleId: "role-reader",
      expectedPermissions: [],
      permissions: Object.values(CAPABILITY),
    };
    await expect(
      api(run, "admin.roles.setPermissions", granted, "reader"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await callA11Tool(run.connection, "set_admin_role_permissions", granted),
    ).toMatchObject({ changed: true, affectedUserIds: ["reader"] });
    expect(
      await run.services.pagesAgentApiService.verify(
        run.tokens.get("reader") ?? "",
      ),
    ).toMatchObject({
      isAdmin: false,
      permissions: Object.values(CAPABILITY).sort(),
    });
    expect(await api(run, "ticket.create", ticket, "reader")).toMatchObject({
      result: { key: expect.any(String) },
    });
    const revoke = {
      operationId: "revoke-role",
      roleId: "role-reader",
      expectedPermissions: Object.values(CAPABILITY),
      permissions: [],
    };
    expect(
      await callA11Tool(run.connection, "set_admin_role_permissions", revoke),
    ).toEqual({ code: "CONFIRMATION_REQUIRED" });
    expect((await account(run, "reader")).role?.permissions).toHaveLength(7);
    const confirmed = { ...revoke, confirmation: "LÖSCHEN" };
    expect(
      await callA11Tool(
        run.connection,
        "set_admin_role_permissions",
        confirmed,
      ),
    ).toMatchObject({ changed: true });
    expect(
      await callA11Tool(
        run.connection,
        "set_admin_role_permissions",
        confirmed,
      ),
    ).toMatchObject({ changed: true });
    expect(
      await run.services.pagesAgentApiService.verify(
        run.tokens.get("reader") ?? "",
      ),
    ).toMatchObject({ permissions: [] });
    await expect(
      api(
        run,
        "ticket.create",
        { ...ticket, operationId: "reader-revoked" },
        "reader",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await audit(run)).toHaveLength(2);
    await expect(
      api(run, "admin.roles.setPermissions", {
        ...granted,
        operationId: "stale",
        expectedPermissions: [CAPABILITY.WRITE],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    for (const permissions of [
      ["admin"],
      ["read"],
      [CAPABILITY.WRITE, CAPABILITY.WRITE],
    ])
      await expect(
        api(run, "admin.roles.setPermissions", {
          ...granted,
          operationId: "invalid",
          permissions,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it.each([
    ["person", "reader", [{ userId: "reader", roleId: "role-reader" }]],
    ["group", "visible-group", [{ userId: "writer", roleId: "role-writer" }]],
    ["department", "beta", [{ userId: "hidden", roleId: "role-hidden" }]],
  ] as const)(
    "assigns and withdraws an existing role for a %s target",
    async (targetType, targetId, expectedAssignments) => {
      const run = await setup();
      vi.stubGlobal("fetch", a11Fetch(run));
      const parameters = {
        operationId: "assign",
        targetType,
        targetId,
        expectedAssignments,
        roleId: "role-manager",
      };
      await expect(
        api(run, "admin.roles.assign", parameters, "writer"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const result = await callA11Tool(
        run.connection,
        "assign_admin_role",
        parameters,
      );
      expect(result).toMatchObject({
        changed: true,
        affectedUserIds: expectedAssignments.map(({ userId }) => userId),
      });
      for (const { userId } of expectedAssignments)
        expect((await account(run, userId)).role?.id).toBe("role-manager");
      const revoke = {
        ...parameters,
        operationId: "withdraw",
        roleId: "role-reader",
        expectedAssignments: expectedAssignments.map(({ userId }) => ({
          userId,
          roleId: "role-manager",
        })),
      };
      expect(
        await callA11Tool(run.connection, "assign_admin_role", revoke),
      ).toEqual({ code: "CONFIRMATION_REQUIRED" });
      expect(
        await callA11Tool(run.connection, "assign_admin_role", {
          ...revoke,
          confirmation: "LÖSCHEN",
        }),
      ).toMatchObject({ changed: true });
      for (const { userId } of expectedAssignments)
        expect((await account(run, userId)).role?.permissions).toEqual([]);
      await expect(
        api(run, "admin.roles.assign", {
          ...parameters,
          operationId: "stale",
          expectedAssignments: revoke.expectedAssignments,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    },
  );

  it.each([
    [
      "set_admin_user_name",
      "admin.users.setName",
      {
        userId: "writer",
        firstName: "Wanda",
        lastName: "Writer",
        expectedFirstName: "Name",
        expectedLastName: "",
      },
    ],
    [
      "set_admin_user_departments",
      "admin.users.setDepartments",
      {
        userId: "writer",
        departmentIds: ["alpha", "beta"],
        expectedDepartmentIds: ["alpha"],
      },
    ],
    [
      "set_admin_user_scope",
      "admin.users.setScope",
      {
        userId: "writer",
        scope: {
          managedDepartments: ["beta"],
          allDepartments: false,
          allProjects: true,
        },
        expectedScope: {
          managedDepartments: [],
          allDepartments: false,
          allProjects: false,
        },
      },
    ],
    [
      "update_admin_group",
      "admin.groups.update",
      {
        groupId: "visible-group",
        name: "Renamed group",
        memberIds: ["writer", "reader"],
        expectedName: "Visible group",
        expectedMemberIds: ["writer"],
      },
    ],
    [
      "rename_admin_department",
      "admin.departments.rename",
      {
        departmentId: "beta",
        name: "Renamed beta",
        expectedName: "Department beta",
      },
    ],
  ])(
    "applies %s and refuses a non-admin without any write",
    async (name, operation, fields) => {
      const run = await setup();
      vi.stubGlobal("fetch", a11Fetch(run));
      const parameters = { ...fields, operationId: "change" };
      await expect(
        api(run, operation, parameters, "writer"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await audit(run)).toEqual([]);
      expect(await callA11Tool(run.connection, name, parameters)).toMatchObject(
        { changed: true },
      );
      expect(await audit(run)).toMatchObject([
        { operation, actorId: "owner", source: "mcp" },
      ]);
      const expectedSnapshot = await new AuthorizationRepository(
        run.database,
      ).snapshot();
      expect(await callA11Tool(run.connection, name, parameters)).toMatchObject(
        { changed: true },
      );
      expect(
        await new AuthorizationRepository(run.database).snapshot(),
      ).toEqual(expectedSnapshot);
      expect(await audit(run)).toHaveLength(1);
      await expect(
        api(run, operation, { ...parameters, name: "Different" }),
      ).rejects.toMatchObject({
        code:
          operation.endsWith("rename") || operation.endsWith("update")
            ? "CONFLICT"
            : "INVALID_REQUEST",
      });
    },
  );

  it("requires localized confirmation for membership/scope reduction and preserves the last department", async () => {
    const run = await setup();
    const repository = new AuthorizationRepository(run.database);
    await repository.saveAccount({
      ...(await account(run, "writer")),
      departments: ["alpha", "beta"],
      managedDepartments: ["alpha"],
      allProjects: true,
    });
    const memberships = {
      operationId: "remove-department",
      userId: "writer",
      departmentIds: ["alpha"],
      expectedDepartmentIds: ["alpha", "beta"],
    };
    await expect(
      api(run, "admin.users.setDepartments", memberships),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(
      api(run, "admin.users.setDepartments", {
        ...memberships,
        confirmation: "DELETE",
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await api(run, "admin.users.setDepartments", {
      ...memberships,
      confirmation: "LÖSCHEN",
    });
    await expect(
      api(run, "admin.users.setDepartments", {
        ...memberships,
        operationId: "last",
        departmentIds: [],
        expectedDepartmentIds: ["alpha"],
        confirmation: "LÖSCHEN",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const scope = {
      operationId: "remove-scope",
      userId: "writer",
      scope: {
        managedDepartments: [],
        allDepartments: false,
        allProjects: false,
      },
      expectedScope: {
        managedDepartments: ["alpha"],
        allDepartments: false,
        allProjects: true,
      },
    };
    await expect(api(run, "admin.users.setScope", scope)).rejects.toMatchObject(
      { code: "CONFIRMATION_REQUIRED" },
    );
    await api(run, "admin.users.setScope", {
      ...scope,
      confirmation: "LÖSCHEN",
    });
    expect((await account(run, "writer")).departments).toEqual(["alpha"]);
    expect(await audit(run)).toHaveLength(2);
  });
});

it("requires confirmation to remove group members and does not assign earlier batch rights to future members", async () => {
  const run = await setup();
  const repository = new AuthorizationRepository(run.database);
  await api(run, "admin.roles.assign", {
    operationId: "current-members",
    targetType: "group",
    targetId: "visible-group",
    roleId: "role-manager",
    expectedAssignments: [{ userId: "writer", roleId: "role-writer" }],
  });
  const addMember = {
    operationId: "add-member",
    groupId: "visible-group",
    name: "Visible group",
    expectedName: "Visible group",
    memberIds: ["reader", "writer"],
    expectedMemberIds: ["writer"],
  };
  await api(run, "admin.groups.update", addMember);
  expect((await account(run, "reader")).role?.id).toBe("role-reader");
  const removeMember = {
    ...addMember,
    operationId: "remove-member",
    memberIds: ["reader"],
    expectedMemberIds: ["reader", "writer"],
  };
  await expect(
    api(run, "admin.groups.update", removeMember),
  ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  await api(run, "admin.groups.update", {
    ...removeMember,
    confirmation: "LÖSCHEN",
  });
  expect(
    (await repository.groups().findAll()).find(
      ({ id }) => id === "visible-group",
    )?.memberIds,
  ).toEqual(["reader"]);
  expect((await account(run, "writer")).role?.id).toBe("role-manager");
});

describe("A11.6 AK-03–06/08: catalog exclusions and atomic audit", () => {
  it.each(CHAT_ADMIN_WRITE_OPERATIONS)(
    "refuses the chat-only operation %s even for MCP administrators",
    async (operation) => {
      const run = await setup();
      const before = await new AuthorizationRepository(run.database).snapshot();
      await expect(
        api(run, operation, {
          operationId: "forbidden",
          confirmation: "LÖSCHEN",
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(
        await new AuthorizationRepository(run.database).snapshot(),
      ).toEqual(before);
      expect(await audit(run)).toEqual([]);
      expect(
        await run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
      ).toEqual([[0]]);
    },
  );

  it("rejects hidden creation/escalation fields and unknown targets without effects", async () => {
    const run = await setup();
    const request = {
      operationId: "existing-only",
      departmentId: "missing",
      name: "New",
      expectedName: "Missing",
    };
    await expect(
      api(run, "admin.departments.rename", request),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const group = {
      operationId: "missing-group",
      groupId: "missing",
      name: "New",
      memberIds: ["writer"],
      expectedName: "Missing",
      expectedMemberIds: [],
    };
    await expect(api(run, "admin.groups.update", group)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    for (const injected of [
      { isAdmin: true },
      { channel: "chat" },
      { create: true },
      { password: "new-password" },
    ])
      await expect(
        api(run, "admin.departments.rename", {
          ...request,
          departmentId: "beta",
          expectedName: "Department beta",
          ...injected,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await audit(run)).toEqual([]);
  });

  it("rolls back mutation, audit and replay if either durable record fails", async () => {
    const run = await setup();
    const parameters = {
      operationId: "rollback",
      departmentId: "beta",
      expectedName: "Department beta",
      name: "Uncommitted",
    };
    vi.spyOn(
      AdministrationActivityRepository.prototype,
      "insert",
    ).mockRejectedValueOnce(new Error("Audit failed"));
    await expect(
      api(run, "admin.departments.rename", parameters),
    ).rejects.toThrow("Audit failed");
    vi.spyOn(
      AgentOperationKeyRepository.prototype,
      "insert",
    ).mockRejectedValueOnce(new Error("Replay failed"));
    await expect(
      api(run, "admin.departments.rename", parameters),
    ).rejects.toThrow("Replay failed");
    expect(
      (
        await new AuthorizationRepository(run.database).snapshot()
      ).departments.find(({ id }) => id === "beta")?.name,
    ).toBe("Department beta");
    expect(await audit(run)).toEqual([]);
    expect(
      await run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
    ).toEqual([[0]]);
    await api(run, "admin.departments.rename", parameters);
    expect(await audit(run)).toHaveLength(1);
  });
});
