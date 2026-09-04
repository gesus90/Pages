import { describe, expect, it } from "vitest";

import { PERMISSION, ROLE } from "@/definition/Role";

describe("role definitions", () => {
  it("exposes the documented role values", () => {
    expect(ROLE.ADMIN).toBe("admin");
    expect(ROLE.PROJECT_MANAGER).toBe("project_manager");
    expect(ROLE.EMPLOYEE).toBe("employee");
  });

  it("exposes the documented permission values", () => {
    expect(PERMISSION.MANAGE_APPLICATION).toBe("manage_application");
    expect(PERMISSION.MANAGE_PROJECTS).toBe("manage_projects");
    expect(PERMISSION.PARTICIPATE_IN_PROJECTS).toBe("participate_in_projects");
  });

  it("contains exactly the supported roles", () => {
    expect(Object.values(ROLE).sort()).toEqual([
      "admin",
      "employee",
      "project_manager",
    ]);
  });

  it("contains exactly the supported permissions", () => {
    expect(Object.values(PERMISSION).sort()).toEqual([
      "manage_application",
      "manage_projects",
      "participate_in_projects",
    ]);
  });
});
