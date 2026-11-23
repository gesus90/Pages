import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AuthorizationRepository } from "./AuthorizationRepository";
import { AdministrationActivityRepository } from "./AdministrationActivityRepository";
import { AgentConnectionScopeRepository } from "./agent/AgentConnectionScopeRepository";
import { AgentProfileStore } from "./agent/AgentProfileStore";
import { EmployeeStore } from "./employee/EmployeeStore";
import { UserGroupRepository } from "./UserGroupRepository";
import { UserRepository } from "./UserRepository";

import type { AccountAccess, UserRole } from "@/definition/Authorization";

type Rows = unknown[][];

interface Harness {
  readonly execute: Mock;
  readonly query: Mock;
  readonly repository: AuthorizationRepository;
}

function repositoryOf(handler: (sql: string) => Rows = () => []): Harness {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async (sql: string) => handler(sql));
  const database = {
    execute,
    query,
    transaction: async (work: (scope: unknown) => Promise<unknown>) =>
      work({ execute, query }),
    readTransaction: async (work: (scope: unknown) => Promise<unknown>) =>
      work({ execute, query }),
  };
  return {
    execute,
    query,
    repository: new AuthorizationRepository(
      database as unknown as ConstructorParameters<
        typeof AuthorizationRepository
      >[0],
    ),
  };
}

function roleOf(): UserRole {
  return {
    id: "r",
    name: "R",
    rank: 5,
    departmentBound: true,
    permissions: [],
  };
}

function accountOf(extra: Partial<AccountAccess> = {}): AccountAccess {
  return {
    userId: "u",
    role: null,
    mode: "admin",
    isAdmin: true,
    firstName: "F",
    lastName: "L",
    isActive: true,
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
    departments: [],
    managedDepartments: [],
    ...extra,
  };
}

it("hands out the shared stores", () => {
  const { repository } = repositoryOf();
  expect(repository.users()).toBeInstanceOf(UserRepository);
  expect(repository.groups()).toBeInstanceOf(UserGroupRepository);
  expect(repository.employees()).toBeInstanceOf(EmployeeStore);
  expect(repository.administrationActivity()).toBeInstanceOf(
    AdministrationActivityRepository,
  );
  expect(repository.agentProfiles()).toBeInstanceOf(AgentProfileStore);
  expect(repository.agentConnectionScopes()).toBeInstanceOf(
    AgentConnectionScopeRepository,
  );
});

it("runs work in a transaction bound repository", async () => {
  const { repository, execute } = repositoryOf();
  const result = await repository.transaction(async (inner) => {
    await inner.activateAdministrator("u");
    return inner.transaction(async (nested) => {
      await nested.snapshot();
      return "done";
    });
  });
  expect(result).toBe("done");
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("active_mode = 'admin'"),
    { id: "u" },
  );
});

it("saves a role with unique permissions", async () => {
  const { repository, execute } = repositoryOf();
  const role = {
    id: "r",
    name: "R",
    rank: 5,
    departmentBound: true,
    permissions: ["write", "write", "milestones"],
  } as unknown as UserRole;
  await repository.saveRole(role);
  expect(execute).toHaveBeenCalledTimes(4);
});

it("deletes a role and a department", async () => {
  const { repository, execute } = repositoryOf();
  await repository.deleteRole("r");
  expect(execute).toHaveBeenCalledTimes(2);
  execute.mockClear();
  await repository.deleteDepartment("d");
  expect(execute).toHaveBeenCalledTimes(5);
  execute.mockClear();
  await repository.saveDepartment({ id: "d", name: "D" });
  expect(execute).toHaveBeenCalledWith(expect.any(String), {
    id: "d",
    name: "D",
  });
});

it("saves an account with memberships", async () => {
  const { repository, execute } = repositoryOf();
  await repository.saveAccount(
    accountOf({
      role: roleOf(),
      departments: ["a", "a", "b"],
      managedDepartments: ["b"],
    }),
  );
  expect(execute).toHaveBeenCalledTimes(6);
  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.any(String),
    expect.objectContaining({ role: "r", had_department: true }),
  );
});

it("saves an account without a role or departments", async () => {
  const { repository, execute } = repositoryOf();
  await repository.saveAccount(accountOf({ hasHadDepartment: true }));
  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.any(String),
    expect.objectContaining({ role: null, had_department: true }),
  );
  expect(execute).toHaveBeenCalledTimes(3);
});

function snapshotRows(
  account: unknown[],
  permission = "write",
  roleId: string | null = "r",
): (sql: string) => Rows {
  return (sql) => {
    if (sql.includes("FROM roles")) return [["r", "Role", 3, 1]];
    if (sql.includes("FROM role_permissions"))
      return [
        ["r", permission],
        ["other", "write"],
      ];
    if (sql.includes("FROM departments")) return [["d", "Dep"]];
    if (sql.includes("FROM department_members"))
      return [
        ["u", "d"],
        ["x", "d"],
      ];
    if (sql.includes("FROM managed_departments"))
      return [
        ["u", "d"],
        ["x", "d"],
      ];
    return [[...account.slice(0, 1), roleId, ...account.slice(2)]];
  };
}

const HUMAN = ["u", "r", 0, "role", "F", "L", 1, 0, 1, 1, "human", 0];

it("reads a human snapshot", async () => {
  const { repository } = repositoryOf(snapshotRows(HUMAN));
  const snapshot = await repository.snapshot();
  expect(snapshot.roles[0]).toEqual({
    id: "r",
    name: "Role",
    rank: 3,
    departmentBound: true,
    permissions: ["write"],
  });
  expect(snapshot.departments).toEqual([{ id: "d", name: "Dep" }]);
  expect(snapshot.accounts[0]).toMatchObject({
    userId: "u",
    mode: "role",
    isActive: true,
    allProjects: true,
    departments: ["d"],
    managedDepartments: ["d"],
  });
  expect(snapshot.accounts[0]).not.toHaveProperty("isAgent");
});

it("reads an agent account without a role", async () => {
  const agent = ["u", null, 1, "admin", "F", "L", 1, 0, 0, 0, "agent", 1];
  const { repository } = repositoryOf((sql) =>
    sql.includes("access.user_id") ? [agent] : [],
  );
  const snapshot = await repository.snapshot();
  expect(snapshot.accounts[0]).toMatchObject({
    role: null,
    isAgent: true,
    hasAgentAdministratorRights: true,
  });
});

it("rejects an unknown role reference", async () => {
  const { repository } = repositoryOf(snapshotRows(HUMAN, "write", "missing"));
  await expect(repository.snapshot()).rejects.toThrow(
    "Invalid account authorization reference.",
  );
});

it("rejects an unknown mode", async () => {
  const row = [...HUMAN];
  row[3] = "other";
  const { repository } = repositoryOf(snapshotRows(row));
  await expect(repository.snapshot()).rejects.toThrow(
    "Invalid account authorization reference.",
  );
});

it("rejects an invalid stored capability", async () => {
  const { repository } = repositoryOf(snapshotRows(HUMAN, "nonsense"));
  await expect(repository.snapshot()).rejects.toThrow(
    "Invalid stored capability.",
  );
});
