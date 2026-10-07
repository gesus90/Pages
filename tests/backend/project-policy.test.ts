import { describe, expect, it } from "vitest";

import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { CAPABILITY } from "@/definition/Authorization";
import { createAccess, createRole } from "../helpers/authorization";

const POLICY = new ProjectPolicyService();
const DEPARTMENTS = ["frontend", "backend"];
const SELECTION = { departmentIds: DEPARTMENTS, hasDepartments: true };

describe("project creation and department assignment policy", () => {
  it("requires project management independently of department management", () => {
    const actor = createAccess({
      role: createRole({ permissions: [CAPABILITY.MANAGE_PROJECTS] }),
    });
    expect(POLICY.canSelectDepartment(actor, "frontend")).toBe(true);
    expect(POLICY.canCreate(actor, SELECTION)).toBe(true);
    expect(POLICY.canSelectDepartment(actor, "support")).toBe(false);
    expect(
      POLICY.canCreate(actor, { ...SELECTION, departmentIds: ["support"] }),
    ).toBe(false);
    expect(
      POLICY.canCreate(
        createAccess({
          role: createRole({ permissions: [CAPABILITY.MANAGE_DEPARTMENTS] }),
        }),
        SELECTION,
      ),
    ).toBe(false);
  });

  it("never treats all departments as all projects", () => {
    const actor = createAccess({
      allDepartments: true,
      managedDepartments: [],
    });
    expect(POLICY.canSelectDepartment(actor, "frontend")).toBe(false);
    expect(POLICY.canCreate(actor, SELECTION)).toBe(false);
    expect(POLICY.canChangeDepartments(actor, DEPARTMENTS, SELECTION)).toBe(
      false,
    );
  });

  it("requires all current departments and allows new departments only within project scope", () => {
    const partial = createAccess({ managedDepartments: ["frontend"] });
    expect(
      POLICY.canChangeDepartments(partial, DEPARTMENTS, {
        ...SELECTION,
        departmentIds: ["frontend"],
      }),
    ).toBe(false);
    expect(
      POLICY.canChangeDepartments(createAccess(), DEPARTMENTS, SELECTION),
    ).toBe(true);
    expect(
      POLICY.canChangeDepartments(createAccess(), DEPARTMENTS, {
        ...SELECTION,
        departmentIds: ["support"],
      }),
    ).toBe(false);
    expect(POLICY.canChangeDepartments(createAccess(), [], SELECTION)).toBe(
      true,
    );
  });

  it("preserves the last department even for administrators while the catalog exists", () => {
    const admin = createAccess({ isAdmin: true, mode: "admin", role: null });
    const empty = { departmentIds: [], hasDepartments: true };
    expect(POLICY.canCreate(admin, empty)).toBe(false);
    expect(POLICY.canChangeDepartments(admin, DEPARTMENTS, empty)).toBe(false);
    expect(POLICY.canCreate(admin, { ...empty, hasDepartments: false })).toBe(
      true,
    );
    expect(
      POLICY.canChangeDepartments(admin, [], {
        ...empty,
        hasDepartments: false,
      }),
    ).toBe(true);
    expect(
      POLICY.canCreate(admin, { ...SELECTION, departmentIds: ["support"] }),
    ).toBe(true);
  });

  it("honors explicit global project responsibility and active mode", () => {
    const global = createAccess({ allProjects: true, managedDepartments: [] });
    expect(POLICY.canCreate(global, SELECTION)).toBe(true);
    expect(POLICY.canChangeDepartments(global, DEPARTMENTS, SELECTION)).toBe(
      true,
    );
    const normalAdmin = createAccess({
      isAdmin: true,
      role: createRole({ permissions: [] }),
    });
    expect(POLICY.canCreate(normalAdmin, SELECTION)).toBe(false);
    expect(POLICY.canCreate(createAccess({ isActive: false }), SELECTION)).toBe(
      false,
    );
  });
});

describe("shared project management and destructive action policy", () => {
  const project = { departmentIds: DEPARTMENTS, isProjectManager: false };

  it("allows partial co-owners and shared project managers to edit general information", () => {
    expect(
      POLICY.canEditGeneral(
        createAccess({ managedDepartments: ["frontend"] }),
        project,
      ),
    ).toBe(true);
    expect(
      POLICY.canEditGeneral(
        createAccess({ managedDepartments: ["support"] }),
        project,
      ),
    ).toBe(false);
    expect(
      POLICY.canEditGeneral(
        createAccess({ allProjects: true, managedDepartments: [] }),
        project,
      ),
    ).toBe(true);
    const member = createAccess({ role: createRole({ permissions: [] }) });
    expect(POLICY.canEditGeneral(member, project)).toBe(false);
    expect(
      POLICY.canEditGeneral(member, { ...project, isProjectManager: true }),
    ).toBe(true);
    expect(
      POLICY.canEditGeneral(
        { ...member, isActive: false },
        { ...project, isProjectManager: true },
      ),
    ).toBe(false);
    expect(
      POLICY.canEditGeneral(
        createAccess({ isAdmin: true, mode: "admin", role: null }),
        project,
      ),
    ).toBe(true);
  });

  it("requires an explicit archive grant with full scope", () => {
    expect(
      POLICY.canArchive(
        createAccess({
          role: createRole({ permissions: [CAPABILITY.MANAGE_PROJECTS] }),
        }),
        DEPARTMENTS,
      ),
    ).toBe(false);
    expect(
      POLICY.canArchive(
        createAccess({ managedDepartments: ["frontend"] }),
        DEPARTMENTS,
      ),
    ).toBe(false);
    expect(POLICY.canArchive(createAccess(), DEPARTMENTS)).toBe(true);
    expect(
      POLICY.canArchive(
        createAccess({ allProjects: true, managedDepartments: [] }),
        DEPARTMENTS,
      ),
    ).toBe(true);
    expect(
      POLICY.canArchive(
        createAccess({ isAdmin: true, mode: "admin", role: null }),
        DEPARTMENTS,
      ),
    ).toBe(true);
    expect(
      POLICY.canArchive(
        createAccess({
          isAdmin: true,
          mode: "role",
          role: createRole({ permissions: [] }),
        }),
        DEPARTMENTS,
      ),
    ).toBe(false);
    expect(
      POLICY.canArchive(createAccess({ isActive: false }), DEPARTMENTS),
    ).toBe(false);
  });

  it("reserves permanent deletion for active admin mode", () => {
    expect(
      POLICY.canDelete(
        createAccess({ isAdmin: true, mode: "admin", role: null }),
      ),
    ).toBe(true);
    expect(POLICY.canDelete(createAccess({ isAdmin: true }))).toBe(false);
    expect(POLICY.canDelete(createAccess())).toBe(false);
    expect(
      POLICY.canDelete(
        createAccess({ isAdmin: true, mode: "admin", isActive: false }),
      ),
    ).toBe(false);
  });
});
