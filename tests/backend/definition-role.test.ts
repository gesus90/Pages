import { describe, expect, it } from "vitest";

import { isRole, PERMISSION, ROLE } from "@/definition/Role";

describe("role definitions", () => {
  it("exposes the documented role values", () => {
    expect(ROLE.ADMIN).toBe("admin");
    expect(ROLE.MANAGER).toBe("manager");
    expect(ROLE.EMPLOYEE).toBe("employee");
  });

  it("exposes the documented permission values", () => {
    expect(PERMISSION.MANAGE_APPLICATION).toBe("manage_application");
    expect(PERMISSION.MANAGE_PROJECTS).toBe("manage_projects");
    expect(PERMISSION.PARTICIPATE_IN_PROJECTS).toBe("participate_in_projects");
    expect(PERMISSION.VIEW_USERS).toBe("view_users");
    expect(PERMISSION.MANAGE_USERS).toBe("manage_users");
  });

  it("contains exactly the supported roles", () => {
    expect(Object.values(ROLE).sort()).toEqual([
      "admin",
      "employee",
      "manager",
    ]);
  });

  it("contains exactly the supported permissions", () => {
    expect(Object.values(PERMISSION).sort()).toEqual([
      "manage_application",
      "manage_projects",
      "manage_users",
      "participate_in_projects",
      "view_users",
    ]);
  });
});

describe("isRole", () => {
  it("accepts every documented role", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("manager")).toBe(true);
    expect(isRole("employee")).toBe(true);
  });

  it("rejects the retired project manager value", () => {
    expect(isRole("project_manager")).toBe(false);
  });

  it("rejects unknown strings", () => {
    expect(isRole("owner")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole("Admin")).toBe(false);
  });

  it.each([null, undefined, 0, 1, true, false, {}, []])(
    "rejects non-string value %p",
    (value) => {
      expect(isRole(value)).toBe(false);
    },
  );
});
