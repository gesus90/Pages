import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { CAPABILITY } from "@/definition/Authorization";
import { PERMISSION, ROLE } from "@/definition/Role";

import { accountFixture, administratorFixture } from "./account-fixture";

import type { User } from "@/definition/User";
import type { Role } from "@/definition/Role";

function legacyUser(role: Role, isActive = true): User {
  return {
    id: "legacy",
    username: "legacy",
    displayName: "Legacy User",
    role,
    isActive,
    mustChangePassword: false,
  };
}

describe("legacy role permissions", () => {
  const service = new PermissionService();

  it.each([
    [ROLE.ADMIN, PERMISSION.MANAGE_APPLICATION, true],
    [ROLE.MANAGER, PERMISSION.MANAGE_APPLICATION, false],
    [ROLE.MANAGER, PERMISSION.MANAGE_USERS, true],
    [ROLE.EMPLOYEE, PERMISSION.MANAGE_USERS, false],
    [ROLE.EMPLOYEE, PERMISSION.PARTICIPATE_IN_PROJECTS, true],
    [ROLE.EMPLOYEE, PERMISSION.VIEW_USERS, false],
  ] as const)("%s and %s -> %s", (role, permission, expected) => {
    expect(service.hasPermission(role, permission)).toBe(expected);
  });

  it("keeps managers inside the employee scope and lets administrators assign any role", () => {
    expect(service.canAssignRole(ROLE.ADMIN, ROLE.ADMIN)).toBe(true);
    expect(service.canAssignRole(ROLE.MANAGER, ROLE.EMPLOYEE)).toBe(true);
    expect(service.canAssignRole(ROLE.MANAGER, ROLE.ADMIN)).toBe(false);
    expect(service.canAssignRole(ROLE.EMPLOYEE, ROLE.EMPLOYEE)).toBe(false);
    expect(service.canManageUser(ROLE.ADMIN, ROLE.MANAGER)).toBe(true);
    expect(service.canManageUser(ROLE.MANAGER, ROLE.MANAGER)).toBe(false);
    expect(service.canManageUser(ROLE.EMPLOYEE, ROLE.EMPLOYEE)).toBe(false);
  });

  it("answers capabilities from the role without resolving an account", async () => {
    expect(
      await service.hasCapability(legacyUser(ROLE.EMPLOYEE), CAPABILITY.WRITE),
    ).toBe(true);
    expect(
      await service.hasCapability(
        legacyUser(ROLE.EMPLOYEE),
        CAPABILITY.MANAGE_PROJECTS,
      ),
    ).toBe(false);
    expect(
      await service.hasCapability(
        legacyUser(ROLE.ADMIN),
        CAPABILITY.ARCHIVE_PROJECTS,
      ),
    ).toBe(true);
    expect(
      await service.hasCapability(
        legacyUser(ROLE.ADMIN, false),
        CAPABILITY.ARCHIVE_PROJECTS,
      ),
    ).toBe(false);
    expect(
      await service.allows(legacyUser(ROLE.MANAGER), PERMISSION.MANAGE_USERS),
    ).toBe(true);
  });
});

describe("current account permissions", () => {
  function serviceFor(account: ReturnType<typeof accountFixture>): {
    service: PermissionService;
    resolve: ReturnType<
      typeof vi.fn<(userId: string) => Promise<typeof account>>
    >;
  } {
    const resolve = vi.fn(async () => account);
    return { service: new PermissionService(resolve), resolve };
  }

  it("resolves the actor's current facts on every check", async () => {
    const { service, resolve } = serviceFor(
      accountFixture({ permissions: [CAPABILITY.WRITE] }),
    );

    await expect(
      service.hasCapability(legacyUser(ROLE.ADMIN), CAPABILITY.WRITE),
    ).resolves.toBe(true);
    await expect(
      service.hasCapability(legacyUser(ROLE.ADMIN), CAPABILITY.MANAGE_PROJECTS),
    ).resolves.toBe(false);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledWith("legacy");
  });

  it("ignores a stale legacy role in favor of the persisted account", async () => {
    const { service } = serviceFor(accountFixture({ hasRole: false }));

    await expect(
      service.allows(legacyUser(ROLE.ADMIN), PERMISSION.MANAGE_APPLICATION),
    ).resolves.toBe(false);
    await expect(
      service.allows(
        legacyUser(ROLE.ADMIN),
        PERMISSION.PARTICIPATE_IN_PROJECTS,
      ),
    ).resolves.toBe(false);
  });

  it("maps legacy permissions onto the capabilities of the account", async () => {
    const administrator = serviceFor(administratorFixture()).service;
    const manager = serviceFor(
      accountFixture({
        permissions: [CAPABILITY.MANAGE_USERS, CAPABILITY.MANAGE_PROJECTS],
      }),
    ).service;
    const employee = serviceFor(accountFixture()).service;
    const user = legacyUser(ROLE.EMPLOYEE);

    await expect(
      administrator.allows(user, PERMISSION.MANAGE_APPLICATION),
    ).resolves.toBe(true);
    await expect(manager.allows(user, PERMISSION.MANAGE_USERS)).resolves.toBe(
      true,
    );
    await expect(manager.allows(user, PERMISSION.VIEW_USERS)).resolves.toBe(
      true,
    );
    await expect(
      manager.allows(user, PERMISSION.MANAGE_PROJECTS),
    ).resolves.toBe(true);
    await expect(employee.allows(user, PERMISSION.VIEW_USERS)).resolves.toBe(
      false,
    );
    await expect(
      employee.allows(user, PERMISSION.PARTICIPATE_IN_PROJECTS),
    ).resolves.toBe(true);
    await expect(
      employee.allows(user, PERMISSION.MANAGE_PROJECTS),
    ).resolves.toBe(false);
  });
});
