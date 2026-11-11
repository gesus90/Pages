import { expect, it, vi } from "vitest";

import { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { AgentEmployeeAdministrationDependencies } from "@/backend/service/employee/AgentEmployeeAdministration";
import type { AccountAccess, UserRole } from "@/definition/Authorization";
import type { Mock } from "vitest";

const role: UserRole = {
  id: "role",
  name: "Worker",
  rank: 1,
  permissions: [],
  departmentBound: false,
};
const admin: AccountAccess = {
  userId: "admin",
  role,
  isAdmin: true,
  mode: "admin",
  firstName: "A",
  lastName: "",
  isActive: true,
  departments: [],
  managedDepartments: [],
  allDepartments: false,
  allProjects: false,
  hasHadDepartment: false,
};
const agent: AccountAccess = {
  ...admin,
  userId: "agent",
  isAdmin: false,
  mode: "role",
  isAgent: true,
};

function fixture(): {
  service: AgentEmployeeAdministration;
  employees: { touch: Mock; find: Mock };
  removals: { isRunning: Mock; remove: Mock };
  users: { setActive: Mock; deleteAvatar: Mock; findById: Mock };
  cache: {
    invalidateUsers: Mock;
    invalidateProjectMembership: Mock;
    invalidateWorkItems: Mock;
  };
  memory: { restore: Mock };
} {
  const snapshot = { roles: [role], departments: [], accounts: [admin, agent] };
  const employees = {
    touch: vi.fn().mockResolvedValue(true),
    find: vi.fn().mockResolvedValue({ revision: 3 }),
  };
  const removals = {
    isRunning: vi.fn().mockResolvedValue(false),
    remove: vi.fn(),
  };
  const users = {
    setActive: vi.fn(),
    deleteAvatar: vi.fn(),
    findById: vi.fn().mockResolvedValue({ displayName: "Agent" }),
  };
  const store = { employees: () => employees, removals: () => removals };
  const repository = {
    snapshot: vi.fn().mockResolvedValue(snapshot),
    employees: () => store,
    users: () => users,
    transaction: async (
      work: (repository: AuthorizationRepository) => Promise<void>,
    ) => work(repository as unknown as AuthorizationRepository),
  };
  const cache = {
    invalidateUsers: vi.fn(),
    invalidateProjectMembership: vi.fn(),
    invalidateWorkItems: vi.fn(),
  };
  const memory = { restore: vi.fn() };
  const dependencies = {
    authorization: repository,
    cache,
    memory,
    models: {},
    activity: {},
  };
  const service = new AgentEmployeeAdministration(
    dependencies as unknown as AgentEmployeeAdministrationDependencies,
  );
  return { service, employees, removals, users, cache, memory };
}

it("requires an active administrator and respects the channel", async () => {
  const { service } = fixture();
  await expect(service.requireAdministrator("admin")).resolves.toBeUndefined();
  await expect(service.requireAdministrator("agent")).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(service.requireAdministrator("missing")).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    service.forChannel("mcp").requireAdministrator("admin"),
  ).resolves.toBeUndefined();
});

it("returns choices and checks target identity before reading its voice name", async () => {
  const { service, users } = fixture();
  await expect(service.choices("admin")).resolves.toEqual({
    roles: [role],
    departments: [],
  });
  await expect(service.choices("agent")).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(service.voiceSampleName("admin", "agent")).resolves.toBe(
    "Agent",
  );
  await expect(service.voiceSampleName("admin", "admin")).rejects.toMatchObject(
    { code: "notFound" },
  );
  users.findById.mockResolvedValueOnce(null);
  await expect(service.voiceSampleName("admin", "agent")).rejects.toMatchObject(
    { code: "notFound" },
  );
});

it("checks revisions and running work before deactivation and removal", async () => {
  const { service, employees, removals, users, cache } = fixture();
  employees.touch.mockResolvedValueOnce(false);
  await expect(
    service.setActive("admin", "agent", { isActive: false, revision: 2 }),
  ).rejects.toMatchObject({ code: "conflict" });
  removals.isRunning.mockResolvedValueOnce(true);
  await expect(
    service.setActive("admin", "agent", { isActive: false, revision: 3 }),
  ).rejects.toMatchObject({ code: "busy" });
  expect(users.setActive).not.toHaveBeenCalled();
  await service.setActive("admin", "agent", { isActive: false, revision: 3 });
  expect(users.setActive).toHaveBeenCalledWith("agent", false);
  await expect(service.remove("admin", "agent", 2)).rejects.toMatchObject({
    code: "conflict",
  });
  await service.remove("admin", "agent", 3);
  expect(removals.remove).toHaveBeenCalledWith("agent");
  expect(cache.invalidateWorkItems).toHaveBeenCalledTimes(2);
});

it("authorizes avatar removal and memory restoration", async () => {
  const { service, users, memory, cache } = fixture();
  await service.removeAvatar("admin", "agent");
  expect(users.deleteAvatar).toHaveBeenCalledWith("agent");
  expect(cache.invalidateUsers).toHaveBeenCalledOnce();
  const version = { id: "version", expectedRevision: 3 };
  await service.restoreMemory("admin", "agent", version);
  expect(memory.restore).toHaveBeenCalledWith("agent", version, "admin");
  await expect(
    service.restoreMemory("agent", "agent", version),
  ).rejects.toMatchObject({ code: "forbidden" });
});
