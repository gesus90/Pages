import { describe, expect, it } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { PERMISSION, ROLE } from "@/definition/Role";
import { CAPABILITY } from "@/definition/Authorization";
import { createAccess, createRole } from "../helpers/authorization";
import { createUser } from "../helpers/factories";

describe("PermissionService", () => {
  it("does not infer archiving from legacy project management", async () => {
    const service = new PermissionService();
    expect(
      await service.hasCapability(
        createUser({ role: ROLE.MANAGER }),
        CAPABILITY.MANAGE_PROJECTS,
      ),
    ).toBe(true);
    expect(
      await service.hasCapability(
        createUser({ role: ROLE.EMPLOYEE }),
        CAPABILITY.MANAGE_PROJECTS,
      ),
    ).toBe(false);
    expect(
      await service.hasCapability(createUser(), CAPABILITY.ARCHIVE_PROJECTS),
    ).toBe(true);
    expect(
      await service.hasCapability(
        createUser({ role: ROLE.MANAGER }),
        CAPABILITY.ARCHIVE_PROJECTS,
      ),
    ).toBe(false);
    expect(
      await service.hasCapability(
        createUser({ isActive: false }),
        CAPABILITY.ARCHIVE_PROJECTS,
      ),
    ).toBe(false);
  });
  it("evaluates every route permission from current facts even for stale admin callers", async () => {
    let account = createAccess({ role: createRole({ permissions: [] }) });
    const service = new PermissionService(async () => account);
    const actor = createUser({ role: ROLE.ADMIN });
    expect(await service.allows(actor, PERMISSION.MANAGE_APPLICATION)).toBe(
      false,
    );
    expect(await service.allows(actor, PERMISSION.VIEW_USERS)).toBe(false);
    expect(await service.allows(actor, PERMISSION.MANAGE_USERS)).toBe(false);
    expect(await service.allows(actor, PERMISSION.MANAGE_PROJECTS)).toBe(false);
    expect(
      await service.allows(actor, PERMISSION.PARTICIPATE_IN_PROJECTS),
    ).toBe(true);
    account = createAccess({
      role: createRole({
        permissions: [CAPABILITY.MANAGE_USERS, CAPABILITY.MANAGE_PROJECTS],
      }),
    });
    expect(await service.allows(actor, PERMISSION.VIEW_USERS)).toBe(true);
    expect(await service.allows(actor, PERMISSION.MANAGE_USERS)).toBe(true);
    expect(await service.allows(actor, PERMISSION.MANAGE_PROJECTS)).toBe(true);
    account = createAccess({ role: null });
    expect(
      await service.allows(actor, PERMISSION.PARTICIPATE_IN_PROJECTS),
    ).toBe(false);
    account = createAccess({ role: null, isAdmin: true, mode: "admin" });
    for (const permission of Object.values(PERMISSION)) {
      expect(await service.allows(actor, permission)).toBe(true);
    }
    account = { ...account, isActive: false };
    expect(
      await service.allows(actor, PERMISSION.PARTICIPATE_IN_PROJECTS),
    ).toBe(false);
    expect(
      await new PermissionService().allows(
        actor,
        PERMISSION.MANAGE_APPLICATION,
      ),
    ).toBe(true);
  });
  it("grants every permission to administrators", () => {
    const service = new PermissionService();

    expect(
      service.hasPermission(ROLE.ADMIN, PERMISSION.MANAGE_APPLICATION),
    ).toBe(true);
    expect(service.hasPermission(ROLE.ADMIN, PERMISSION.MANAGE_PROJECTS)).toBe(
      true,
    );
    expect(
      service.hasPermission(ROLE.ADMIN, PERMISSION.PARTICIPATE_IN_PROJECTS),
    ).toBe(true);
    expect(service.hasPermission(ROLE.ADMIN, PERMISSION.VIEW_USERS)).toBe(true);
    expect(service.hasPermission(ROLE.ADMIN, PERMISSION.MANAGE_USERS)).toBe(
      true,
    );
  });

  it("grants project management and participation to managers", () => {
    const service = new PermissionService();

    expect(
      service.hasPermission(ROLE.MANAGER, PERMISSION.MANAGE_PROJECTS),
    ).toBe(true);
    expect(
      service.hasPermission(ROLE.MANAGER, PERMISSION.PARTICIPATE_IN_PROJECTS),
    ).toBe(true);
    expect(service.hasPermission(ROLE.MANAGER, PERMISSION.VIEW_USERS)).toBe(
      true,
    );
    expect(service.hasPermission(ROLE.MANAGER, PERMISSION.MANAGE_USERS)).toBe(
      true,
    );
  });

  it("denies application management to managers", () => {
    const service = new PermissionService();

    expect(
      service.hasPermission(ROLE.MANAGER, PERMISSION.MANAGE_APPLICATION),
    ).toBe(false);
  });

  it("grants only participation to employees", () => {
    const service = new PermissionService();

    expect(
      service.hasPermission(ROLE.EMPLOYEE, PERMISSION.PARTICIPATE_IN_PROJECTS),
    ).toBe(true);
    expect(
      service.hasPermission(ROLE.EMPLOYEE, PERMISSION.MANAGE_PROJECTS),
    ).toBe(false);
    expect(
      service.hasPermission(ROLE.EMPLOYEE, PERMISSION.MANAGE_APPLICATION),
    ).toBe(false);
    expect(service.hasPermission(ROLE.EMPLOYEE, PERMISSION.VIEW_USERS)).toBe(
      false,
    );
    expect(service.hasPermission(ROLE.EMPLOYEE, PERMISSION.MANAGE_USERS)).toBe(
      false,
    );
  });
});

describe("PermissionService role assignment", () => {
  it("lets administrators assign every role", () => {
    const service = new PermissionService();

    expect(service.canAssignRole(ROLE.ADMIN, ROLE.ADMIN)).toBe(true);
    expect(service.canAssignRole(ROLE.ADMIN, ROLE.MANAGER)).toBe(true);
    expect(service.canAssignRole(ROLE.ADMIN, ROLE.EMPLOYEE)).toBe(true);
  });

  it("lets managers assign only employees", () => {
    const service = new PermissionService();

    expect(service.canAssignRole(ROLE.MANAGER, ROLE.EMPLOYEE)).toBe(true);
    expect(service.canAssignRole(ROLE.MANAGER, ROLE.MANAGER)).toBe(false);
    expect(service.canAssignRole(ROLE.MANAGER, ROLE.ADMIN)).toBe(false);
  });

  it("lets employees assign no role", () => {
    const service = new PermissionService();

    expect(service.canAssignRole(ROLE.EMPLOYEE, ROLE.EMPLOYEE)).toBe(false);
    expect(service.canAssignRole(ROLE.EMPLOYEE, ROLE.MANAGER)).toBe(false);
    expect(service.canAssignRole(ROLE.EMPLOYEE, ROLE.ADMIN)).toBe(false);
  });
});

describe("PermissionService user management scope", () => {
  it("lets administrators manage every role", () => {
    const service = new PermissionService();

    expect(service.canManageUser(ROLE.ADMIN, ROLE.ADMIN)).toBe(true);
    expect(service.canManageUser(ROLE.ADMIN, ROLE.MANAGER)).toBe(true);
    expect(service.canManageUser(ROLE.ADMIN, ROLE.EMPLOYEE)).toBe(true);
  });

  it("lets managers manage only employees", () => {
    const service = new PermissionService();

    expect(service.canManageUser(ROLE.MANAGER, ROLE.EMPLOYEE)).toBe(true);
    expect(service.canManageUser(ROLE.MANAGER, ROLE.MANAGER)).toBe(false);
    expect(service.canManageUser(ROLE.MANAGER, ROLE.ADMIN)).toBe(false);
  });

  it("lets employees manage no one", () => {
    const service = new PermissionService();

    expect(service.canManageUser(ROLE.EMPLOYEE, ROLE.EMPLOYEE)).toBe(false);
    expect(service.canManageUser(ROLE.EMPLOYEE, ROLE.MANAGER)).toBe(false);
    expect(service.canManageUser(ROLE.EMPLOYEE, ROLE.ADMIN)).toBe(false);
  });
});
