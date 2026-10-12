import { describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { AgentAdministrationService } from "@/backend/service/agents/AgentAdministrationService";
import * as extensionReads from "@/backend/service/agents/AgentExtensionReads";
import { CAPABILITY } from "@/definition/Authorization";

import { useA11McpHarness } from "../helpers/a11-mcp";

const setup = useA11McpHarness();
type Harness = Awaited<ReturnType<typeof setup>>;

const ADMIN_IDENTITY = { userId: "owner", isAdmin: true, permissions: [] };

async function api(
  run: Harness,
  operation: string,
  parameters: Readonly<Record<string, unknown>>,
  userId = "owner",
) {
  return run.services.pagesAgentApiService.handle(
    run.tokens.get(userId) ?? "",
    {
      operation,
      parameters,
    },
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

/** Adds accounts with long identifiers who all hold one role and, optionally, one department. */
async function addCrowd(
  run: Harness,
  size: number,
  roleId: string,
  departmentId: string | null,
): Promise<void> {
  await run.database.execute(
    `
    INSERT INTO users (id, username, display_name, password_hash, role)
    SELECT
        'crowd-' || repeat('x', 180) || CAST(index AS VARCHAR),
        'crowd-' || CAST(index AS VARCHAR),
        'Crowd',
        'hash',
        'employee'
    FROM range($size) AS series(index);
  `,
    { size },
  );
  await run.database.execute(
    `
    INSERT INTO user_authorization (user_id, role_id, active_mode)
    SELECT id, $role_id, 'role'
    FROM users
    WHERE id LIKE 'crowd-%';
  `,
    { role_id: roleId },
  );
  if (departmentId === null) return;
  await run.database.execute(
    `
    INSERT INTO department_members (user_id, department_id)
    SELECT id, $department_id
    FROM users
    WHERE id LIKE 'crowd-%';
  `,
    { department_id: departmentId },
  );
}

describe("A11.10 g5: changes that leave the stored state as it is", () => {
  it("reports an unchanged name, department set and department name without audit entries", async () => {
    const run = await setup();
    const writer = await account(run, "writer");
    const unchanged = await api(run, "admin.users.setName", {
      operationId: "same-name",
      userId: "writer",
      firstName: writer.firstName,
      lastName: writer.lastName,
      expectedFirstName: writer.firstName,
      expectedLastName: writer.lastName,
    });
    expect(unchanged).toMatchObject({
      result: { id: "writer", changed: false, affectedUserIds: [] },
    });
    expect(
      await api(run, "admin.users.setDepartments", {
        operationId: "same-departments",
        userId: "writer",
        departmentIds: ["alpha"],
        expectedDepartmentIds: ["alpha"],
      }),
    ).toMatchObject({ result: { changed: false, affectedUserIds: [] } });
    expect(
      await api(run, "admin.departments.rename", {
        operationId: "same-department-name",
        departmentId: "beta",
        name: "Department beta",
        expectedName: "Department beta",
      }),
    ).toMatchObject({ result: { changed: false, affectedUserIds: [] } });
    expect(await audit(run)).toEqual([]);
    expect((await account(run, "writer")).lastName).toBe(writer.lastName);
  });

  it("changes only the surname when the first name stays as it is", async () => {
    const run = await setup();
    const writer = await account(run, "writer");
    expect(
      await api(run, "admin.users.setName", {
        operationId: "surname",
        userId: "writer",
        firstName: writer.firstName,
        lastName: "Surname",
        expectedFirstName: writer.firstName,
        expectedLastName: writer.lastName,
      }),
    ).toMatchObject({ result: { changed: true, affectedUserIds: ["writer"] } });
    expect(await account(run, "writer")).toMatchObject({
      firstName: writer.firstName,
      lastName: "Surname",
    });
    expect(await audit(run)).toHaveLength(1);
  });

  it("refuses a name change when the person is missing from the administrator directory", async () => {
    const run = await setup();
    const writer = await account(run, "writer");
    vi.spyOn(
      AdministrationService.prototype,
      "listUsers",
    ).mockResolvedValueOnce([]);
    await expect(
      api(run, "admin.users.setName", {
        operationId: "vanished",
        userId: "writer",
        firstName: "Changed",
        lastName: writer.lastName,
        expectedFirstName: writer.firstName,
        expectedLastName: writer.lastName,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await account(run, "writer")).firstName).toBe(writer.firstName);
    expect(await audit(run)).toEqual([]);
  });
});

describe("A11.10 g5: role permissions and assignments", () => {
  it("refuses an unknown role and reports an unchanged permission set without audit", async () => {
    const run = await setup();
    await expect(
      api(run, "admin.roles.setPermissions", {
        operationId: "missing-role",
        roleId: "role-missing",
        permissions: [],
        expectedPermissions: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await api(run, "admin.roles.setPermissions", {
        operationId: "same-permissions",
        roleId: "role-reader",
        permissions: [],
        expectedPermissions: [],
      }),
    ).toMatchObject({
      result: {
        id: "role-reader",
        changed: false,
        affectedUserIds: ["reader"],
      },
    });
    expect(await audit(run)).toEqual([]);
  });

  it.each([
    ["department", "unknown-department", "NOT_FOUND"],
    ["group", "unknown-group", "NOT_FOUND"],
    ["role", "reader", "INVALID_REQUEST"],
  ])(
    "refuses an assignment to a %s target that cannot be resolved",
    async (targetType, targetId, code) => {
      const run = await setup();
      await expect(
        api(run, "admin.roles.assign", {
          operationId: "unresolved",
          targetType,
          targetId,
          roleId: "role-manager",
          expectedAssignments: [],
        }),
      ).rejects.toMatchObject({ code });
      expect(await audit(run)).toEqual([]);
    },
  );

  it("refuses an unknown role for a resolvable person", async () => {
    const run = await setup();
    await expect(
      api(run, "admin.roles.assign", {
        operationId: "unknown-role",
        targetType: "person",
        targetId: "reader",
        roleId: "role-missing",
        expectedAssignments: [{ userId: "reader", roleId: "role-reader" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await account(run, "reader")).role?.id).toBe("role-reader");
  });

  it("refuses a batch of more than 100 accounts before comparing the expected state", async () => {
    const run = await setup();
    await run.database.execute(
      "INSERT INTO departments (id, name) VALUES ('crowd-department', 'Crowd');",
    );
    await addCrowd(run, 101, "role-reader", "crowd-department");
    await expect(
      api(run, "admin.roles.assign", {
        operationId: "too-many",
        targetType: "department",
        targetId: "crowd-department",
        roleId: "role-manager",
        expectedAssignments: [],
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect((await account(run, "reader")).role?.id).toBe("role-reader");
  });

  it("assigns a role to an administrator who has no role yet", async () => {
    const run = await setup();
    const authorization = new AuthorizationRepository(run.database);
    await authorization.saveAccount({
      ...(await account(run, "owner")),
      role: null,
    });
    expect(
      await api(run, "admin.roles.assign", {
        operationId: "roleless",
        targetType: "person",
        targetId: "owner",
        roleId: "role-manager",
        expectedAssignments: [{ userId: "owner", roleId: null }],
      }),
    ).toMatchObject({
      result: {
        targetType: "person",
        changed: true,
        affectedUserIds: ["owner"],
      },
    });
    expect((await account(run, "owner")).role?.id).toBe("role-manager");
  });
});

describe("A11.10 g5: management scope", () => {
  const scopeOf = (
    managedDepartments: readonly string[],
    allDepartments: boolean,
    allProjects = false,
  ) => ({ managedDepartments, allDepartments, allProjects });

  async function changeScope(
    run: Harness,
    operationId: string,
    expectedScope: ReturnType<typeof scopeOf>,
    scope: ReturnType<typeof scopeOf>,
    confirmation?: string,
  ) {
    return api(run, "admin.users.setScope", {
      operationId,
      userId: "writer",
      scope,
      expectedScope,
      ...(confirmation === undefined ? {} : { confirmation }),
    });
  }

  it("asks for confirmation when reducing departments or managed departments, and reports no change for the same scope", async () => {
    const run = await setup();
    await changeScope(
      run,
      "grant",
      scopeOf([], false),
      scopeOf(["alpha"], true),
    );
    await expect(
      changeScope(
        run,
        "drop-all-departments",
        scopeOf(["alpha"], true),
        scopeOf(["alpha"], false),
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await changeScope(
      run,
      "drop-all-departments-confirmed",
      scopeOf(["alpha"], true),
      scopeOf(["alpha"], false),
      "LÖSCHEN",
    );
    await expect(
      changeScope(
        run,
        "drop-managed",
        scopeOf(["alpha"], false),
        scopeOf([], false),
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(
      await changeScope(
        run,
        "extend-managed",
        scopeOf(["alpha"], false),
        scopeOf(["alpha", "beta"], false),
      ),
    ).toMatchObject({ result: { changed: true, affectedUserIds: ["writer"] } });
    expect(
      await changeScope(
        run,
        "keep-managed",
        scopeOf(["alpha", "beta"], false),
        scopeOf(["alpha", "beta"], false),
      ),
    ).toMatchObject({ result: { changed: false, affectedUserIds: [] } });
    expect(
      [...(await account(run, "writer")).managedDepartments].sort(),
    ).toEqual(["alpha", "beta"]);
    expect(await audit(run)).toHaveLength(3);
  });
});

describe("A11.10 g5: administrator boundary and response limits", () => {
  it.each([
    ["inactive", "UPDATE users SET is_active = 0 WHERE id = 'owner';"],
    [
      "password-gated",
      "UPDATE users SET must_change_password = 1 WHERE id = 'owner';",
    ],
  ])(
    "rejects a %s actor with an invalid token before reading anything",
    async (_label, statement) => {
      const run = await setup();
      await run.database.execute(statement);
      const service = new AgentAdministrationService(
        run.database,
        ServerCache.disabled(),
      );
      await expect(
        service.handle(ADMIN_IDENTITY, "admin.groups.list", {}),
      ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
      await expect(
        service.handle(
          { ...ADMIN_IDENTITY, userId: "unknown-user" },
          "admin.groups.list",
          {},
        ),
      ).rejects.toMatchObject({ status: 401 });
    },
  );

  it("refuses a read response above the wire limit and still serves a smaller page", async () => {
    const run = await setup();
    const groups = new AuthorizationRepository(run.database).groups();
    await groups.save({
      id: "huge-group",
      name: "x".repeat(1_100_000),
      memberIds: [],
    });
    await expect(api(run, "admin.groups.list", {})).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(await api(run, "admin.roles.list", { limit: 1 })).toMatchObject({
      result: {
        entries: [expect.objectContaining({ id: expect.any(String) })],
      },
    });
  });

  it("rolls back a write whose result is above the wire limit", async () => {
    const run = await setup();
    await addCrowd(run, 6000, "role-reader", null);
    const insert = vi.spyOn(AgentOperationKeyRepository.prototype, "insert");
    await expect(
      api(run, "admin.roles.setPermissions", {
        operationId: "huge-result",
        roleId: "role-reader",
        permissions: [CAPABILITY.WRITE],
        expectedPermissions: [],
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect((await account(run, "reader")).role?.permissions).toEqual([]);
    expect(insert).not.toHaveBeenCalled();
    expect(await audit(run)).toEqual([]);
  }, 60_000);
});

describe("A11.10 g5: administrator reads of unusual records", () => {
  it("leaves a user row without an authorization account out of the user list", async () => {
    const run = await setup();
    await run.database.execute(
      "INSERT INTO users (id, username, display_name, password_hash, role) VALUES ('orphan', 'orphan', 'Orphan', 'hash', 'employee');",
    );
    const result = await api(run, "admin.users.list", {});
    expect(result).toMatchObject({ result: { total: 5 } });
    expect(JSON.stringify(result)).not.toContain("orphan");
  });

  it("refuses a project-member read whose result is not a member list", async () => {
    const run = await setup();
    vi.spyOn(extensionReads, "readAgentExtension").mockResolvedValueOnce({
      people: [],
      total: 0,
      nextCursor: null,
    });
    await expect(
      api(run, "admin.projectMembers.read", { projectId: "p1" }),
    ).rejects.toThrow("Invalid project-member result.");
  });
});

describe("A11.10 g5: translation of administration failures", () => {
  it("translates unknown targets and invalid input of the UI services", async () => {
    const run = await setup();
    await expect(
      api(run, "admin.users.setName", {
        operationId: "unknown-person",
        userId: "nobody",
        firstName: "A",
        lastName: "B",
        expectedFirstName: "A",
        expectedLastName: "B",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      api(run, "admin.departments.rename", {
        operationId: "duplicate-name",
        departmentId: "beta",
        name: "Department alpha",
        expectedName: "Department beta",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await audit(run)).toEqual([]);
  });

  it("translates a taken username or email of the chat channel to a conflict", async () => {
    const run = await setup();
    const service = new AgentAdministrationService(
      run.database,
      ServerCache.disabled(),
      "chat",
    );
    const person = {
      firstName: "New",
      lastName: "Person",
      roleId: "role-writer",
      isAdmin: false,
      departmentIds: ["alpha"],
      confirmation: "LÖSCHEN",
    };
    await expect(
      service.handle(ADMIN_IDENTITY, "admin.users.create", {
        ...person,
        operationId: "taken-username",
        username: "writer",
        email: null,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await service.handle(ADMIN_IDENTITY, "admin.users.create", {
      ...person,
      operationId: "first-email",
      username: "first-person",
      email: "taken@example.invalid",
    });
    await expect(
      service.handle(ADMIN_IDENTITY, "admin.users.create", {
        ...person,
        operationId: "taken-email",
        username: "second-person",
        email: "taken@example.invalid",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
