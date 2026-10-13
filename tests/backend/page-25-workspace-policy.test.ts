import { describe, expect, it } from "vitest";

import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { CAPABILITY } from "@/definition/Authorization";

import { createAccess, createRole } from "../helpers/authorization";
import { useMigratedDatabase } from "../helpers/test-database";

describe("PAGE-25 workspace management policy", () => {
  const policy = new ProjectPolicyService();
  const project = { departmentIds: ["frontend"], isProjectManager: false };

  it("lets an administrator in admin mode manage every project", () => {
    expect(
      policy.canManageWorkspaces(
        createAccess({ isAdmin: true, mode: "admin", role: null }),
        project,
      ),
    ).toBe(true);
  });

  it("does not let an administrator in role mode manage without another right", () => {
    expect(
      policy.canManageWorkspaces(
        createAccess({
          isAdmin: true,
          mode: "role",
          role: createRole({ permissions: [] }),
          managedDepartments: [],
        }),
        project,
      ),
    ).toBe(false);
  });

  it("lets the manager of the project manage it without a global right", () => {
    expect(
      policy.canManageWorkspaces(
        createAccess({
          role: createRole({ permissions: [], departmentBound: false }),
          managedDepartments: [],
        }),
        { ...project, isProjectManager: true },
      ),
    ).toBe(true);
  });

  it("needs the project right together with a scope over the project", () => {
    const manager = createAccess({ managedDepartments: ["frontend"] });
    expect(policy.canManageWorkspaces(manager, project)).toBe(true);
    expect(
      policy.canManageWorkspaces(
        createAccess({ managedDepartments: ["backend"] }),
        project,
      ),
    ).toBe(false);
    expect(
      policy.canManageWorkspaces(
        createAccess({
          role: createRole({ permissions: [CAPABILITY.WRITE] }),
          managedDepartments: ["frontend"],
        }),
        project,
      ),
    ).toBe(false);
    expect(
      policy.canManageWorkspaces(
        createAccess({ managedDepartments: [], allProjects: true }),
        project,
      ),
    ).toBe(true);
  });

  it("never lets an inactive account manage", () => {
    expect(
      policy.canManageWorkspaces(
        createAccess({ isActive: false, managedDepartments: ["frontend"] }),
        { ...project, isProjectManager: true },
      ),
    ).toBe(false);
  });
});

describe("PAGE-25 managed project lookup", () => {
  const getDatabase = useMigratedDatabase();

  it("returns the projects of the user's manager roles, and only those", async () => {
    const database = getDatabase();
    for (const id of ["a", "b", "c"])
      await database.execute(
        "INSERT INTO projects (id, name, owner_id) VALUES ($id, $id, 'owner');",
        { id },
      );
    for (const id of ["lead", "member"])
      await database.execute(
        "INSERT INTO users (id, username, display_name, password_hash, role) VALUES ($id, $id, $id, 'hash', 'employee');",
        { id },
      );
    const projects = new ProjectRepository(database);
    await projects.addMember("b", "lead", "manager");
    await projects.addMember("a", "lead", "manager");
    await projects.addMember("c", "lead", "member");
    await projects.addMember("a", "member", "manager");

    expect(await projects.findManagedProjectIds("lead")).toEqual(["a", "b"]);
    expect(await projects.findManagedProjectIds("member")).toEqual(["a"]);
    expect(await projects.findManagedProjectIds("nobody")).toEqual([]);
  });
});
