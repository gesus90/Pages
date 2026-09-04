import { describe, expect, it } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { PERMISSION, ROLE } from "@/definition/Role";

describe("PermissionService", () => {
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
  });

  it("grants project management and participation to project managers", () => {
    const service = new PermissionService();

    expect(
      service.hasPermission(ROLE.PROJECT_MANAGER, PERMISSION.MANAGE_PROJECTS),
    ).toBe(true);
    expect(
      service.hasPermission(
        ROLE.PROJECT_MANAGER,
        PERMISSION.PARTICIPATE_IN_PROJECTS,
      ),
    ).toBe(true);
  });

  it("denies application management to project managers", () => {
    const service = new PermissionService();

    expect(
      service.hasPermission(
        ROLE.PROJECT_MANAGER,
        PERMISSION.MANAGE_APPLICATION,
      ),
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
  });
});
