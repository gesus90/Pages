import { expect, it, vi } from "vitest";

import { logEvent } from "@/backend/logging/Logger";
import { ADMINISTRATION_ROLE_ID, CAPABILITY } from "@/definition/Authorization";
import { PERMISSION, ROLE } from "@/definition/Role";

import { PermissionService } from "./PermissionService";

import type { AccountAccess, UserRole } from "@/definition/Authorization";
import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";

vi.mock("@/backend/logging/Logger", () => ({
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
}));

const managerRole: UserRole = {
  id: "role-manager",
  name: "Manager",
  rank: 2,
  departmentBound: false,
  permissions: [CAPABILITY.MANAGE_PROJECTS, CAPABILITY.MANAGE_USERS],
};

const emptyRole: UserRole = {
  id: "role-empty",
  name: "Empty",
  rank: 1,
  departmentBound: true,
  permissions: [],
};

const administrationRole: UserRole = {
  id: ADMINISTRATION_ROLE_ID,
  name: "Administration",
  rank: 3,
  departmentBound: false,
  permissions: [],
};

function user(role: Role, isActive = true): User {
  return {
    id: "user-1",
    username: "ada",
    displayName: "Ada Lovelace",
    role,
    isActive,
    mustChangePassword: false,
  };
}

function account(overrides: Partial<AccountAccess> = {}): AccountAccess {
  return {
    userId: "user-1",
    role: null,
    isAdmin: false,
    mode: "role",
    firstName: "Ada",
    lastName: "Lovelace",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
    ...overrides,
  };
}

function serviceResolving(current: AccountAccess): PermissionService {
  return new PermissionService(() => Promise.resolve(current));
}

const administratorAccount = account({ isAdmin: true, mode: "admin" });

it("grants each role exactly its permissions", () => {
  const service = new PermissionService();

  expect(service.hasPermission(ROLE.ADMIN, PERMISSION.MANAGE_APPLICATION)).toBe(
    true,
  );
  expect(
    service.hasPermission(ROLE.MANAGER, PERMISSION.MANAGE_APPLICATION),
  ).toBe(false);
  expect(service.hasPermission(ROLE.MANAGER, PERMISSION.MANAGE_USERS)).toBe(
    true,
  );
  expect(service.hasPermission(ROLE.EMPLOYEE, PERMISSION.MANAGE_PROJECTS)).toBe(
    false,
  );
  expect(
    service.hasPermission(ROLE.EMPLOYEE, PERMISSION.PARTICIPATE_IN_PROJECTS),
  ).toBe(true);
});

it("assigns any role as administrator and only employees as manager", () => {
  const service = new PermissionService();

  expect(service.canAssignRole(ROLE.ADMIN, ROLE.ADMIN)).toBe(true);
  expect(service.canAssignRole(ROLE.MANAGER, ROLE.EMPLOYEE)).toBe(true);
  expect(service.canAssignRole(ROLE.MANAGER, ROLE.MANAGER)).toBe(false);
  expect(service.canAssignRole(ROLE.MANAGER, ROLE.ADMIN)).toBe(false);
  expect(service.canAssignRole(ROLE.EMPLOYEE, ROLE.EMPLOYEE)).toBe(false);
});

it("manages users as administrator and as manager only within employees", () => {
  const service = new PermissionService();

  expect(service.canManageUser(ROLE.ADMIN, ROLE.MANAGER)).toBe(true);
  expect(service.canManageUser(ROLE.MANAGER, ROLE.EMPLOYEE)).toBe(true);
  expect(service.canManageUser(ROLE.MANAGER, ROLE.MANAGER)).toBe(false);
  expect(service.canManageUser(ROLE.EMPLOYEE, ROLE.EMPLOYEE)).toBe(false);
});

it("evaluates capabilities from the stored role without a resolver", async () => {
  const service = new PermissionService();

  expect(
    await service.hasCapability(user(ROLE.ADMIN), CAPABILITY.ARCHIVE_PROJECTS),
  ).toBe(true);
  expect(
    await service.hasCapability(
      user(ROLE.ADMIN, false),
      CAPABILITY.ARCHIVE_PROJECTS,
    ),
  ).toBe(false);
  expect(
    await service.hasCapability(
      user(ROLE.MANAGER),
      CAPABILITY.ARCHIVE_PROJECTS,
    ),
  ).toBe(false);
  expect(
    await service.hasCapability(user(ROLE.EMPLOYEE), CAPABILITY.WRITE),
  ).toBe(true);
  expect(
    await service.hasCapability(user(ROLE.MANAGER), CAPABILITY.MANAGE_PROJECTS),
  ).toBe(true);
  expect(
    await service.hasCapability(
      user(ROLE.EMPLOYEE),
      CAPABILITY.MANAGE_PROJECTS,
    ),
  ).toBe(false);
});

it("reports no business management without a resolver", async () => {
  const service = new PermissionService();

  expect(await service.isManagement(user(ROLE.ADMIN))).toBe(false);
});

it("allows a stored permission without logging", async () => {
  const service = new PermissionService();

  expect(await service.allows(user(ROLE.ADMIN), PERMISSION.MANAGE_USERS)).toBe(
    true,
  );
  expect(logEvent).not.toHaveBeenCalled();
});

it("logs the denial of a stored permission with the operation and the user", async () => {
  const service = new PermissionService();

  expect(
    await service.allows(user(ROLE.EMPLOYEE), PERMISSION.MANAGE_PROJECTS),
  ).toBe(false);
  expect(logEvent).toHaveBeenCalledWith({
    level: "warn",
    event: "authorization.permission.denied",
    component: "PermissionService",
    message: "Account permission denied",
    metadata: { userId: "user-1", operation: PERMISSION.MANAGE_PROJECTS },
  });
});

it("resolves capabilities of the current account when a resolver is supplied", async () => {
  const service = serviceResolving(administratorAccount);

  expect(
    await service.hasCapability(user(ROLE.EMPLOYEE), CAPABILITY.WRITE),
  ).toBe(true);
  expect(
    await service.hasCapability(user(ROLE.ADMIN), CAPABILITY.ARCHIVE_PROJECTS),
  ).toBe(true);
});

it("uses the current role of the resolved account rather than the stored role", async () => {
  const service = serviceResolving(
    account({ role: emptyRole, departments: [] }),
  );

  expect(
    await service.hasCapability(user(ROLE.ADMIN), CAPABILITY.MANAGE_PROJECTS),
  ).toBe(false);
  expect(await service.hasCapability(user(ROLE.ADMIN), CAPABILITY.WRITE)).toBe(
    false,
  );
});

it("recognizes business management through the resolved account only", async () => {
  const management = serviceResolving(account({ role: administrationRole }));

  expect(await management.isManagement(user(ROLE.EMPLOYEE))).toBe(true);
  expect(
    await serviceResolving(account({ role: emptyRole })).isManagement(
      user(ROLE.ADMIN),
    ),
  ).toBe(false);
});

it("grants application management to the resolved administrator only", async () => {
  expect(
    await serviceResolving(administratorAccount).allows(
      user(ROLE.ADMIN),
      PERMISSION.MANAGE_APPLICATION,
    ),
  ).toBe(true);
  expect(
    await serviceResolving(account({ role: managerRole })).allows(
      user(ROLE.MANAGER),
      PERMISSION.MANAGE_APPLICATION,
    ),
  ).toBe(false);
});

it("requires an active account with an administrator or role to participate in projects", async () => {
  const participate = (current: AccountAccess): Promise<boolean> =>
    serviceResolving(current).allows(
      user(ROLE.EMPLOYEE),
      PERMISSION.PARTICIPATE_IN_PROJECTS,
    );

  expect(await participate(administratorAccount)).toBe(true);
  expect(await participate(account({ role: emptyRole }))).toBe(true);
  expect(await participate(account())).toBe(false);
  expect(await participate(account({ role: emptyRole, isActive: false }))).toBe(
    false,
  );
});

it("lets anyone who may enter the management area view users", async () => {
  const view = (current: AccountAccess): Promise<boolean> =>
    serviceResolving(current).allows(user(ROLE.MANAGER), PERMISSION.VIEW_USERS);

  expect(await view(account({ role: managerRole }))).toBe(true);
  expect(await view(account({ role: emptyRole }))).toBe(false);
});

it("checks user management and project management against their capabilities", async () => {
  const manager = serviceResolving(account({ role: managerRole }));
  const employee = serviceResolving(account({ role: emptyRole }));

  expect(
    await manager.allows(user(ROLE.MANAGER), PERMISSION.MANAGE_USERS),
  ).toBe(true);
  expect(
    await manager.allows(user(ROLE.MANAGER), PERMISSION.MANAGE_PROJECTS),
  ).toBe(true);
  expect(
    await employee.allows(user(ROLE.EMPLOYEE), PERMISSION.MANAGE_USERS),
  ).toBe(false);
  expect(
    await employee.allows(user(ROLE.EMPLOYEE), PERMISSION.MANAGE_PROJECTS),
  ).toBe(false);
});

it("logs the denial of a permission evaluated for a resolved account", async () => {
  const denied = await serviceResolving(account({ role: emptyRole })).allows(
    user(ROLE.EMPLOYEE),
    PERMISSION.MANAGE_APPLICATION,
  );

  expect(denied).toBe(false);
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "authorization.permission.denied",
      metadata: { userId: "user-1", operation: PERMISSION.MANAGE_APPLICATION },
    }),
  );
});
