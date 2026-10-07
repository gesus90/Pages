import { describe, expect, it } from "vitest";

import { WorkItemTemplatePolicy } from "@/backend/auth/WorkItemTemplatePolicy";
import { CAPABILITY } from "@/definition/Authorization";
import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";
import { createAccess, createRole } from "../helpers/authorization";

import type { TemplateSharing } from "@/definition/WorkItemTemplate";

const policy = new WorkItemTemplatePolicy();
const WRITER_ROLE = createRole({ permissions: [CAPABILITY.WRITE] });
const writer = createAccess({
  departments: ["frontend"],
  managedDepartments: [],
  role: WRITER_ROLE,
  userId: "writer",
});
const manager = createAccess({
  departments: ["frontend"],
  managedDepartments: ["frontend", "backend"],
  userId: "manager",
});
const administrator = createAccess({
  isAdmin: true,
  mode: "admin",
  role: null,
  userId: "admin",
});
const adminInRoleMode = createAccess({
  isAdmin: true,
  mode: "role",
  role: WRITER_ROLE,
  userId: "admin",
});
const inactive = createAccess({ isActive: false, userId: "owner" });
const NO_PROJECTS: ReadonlySet<string> = new Set();
const PROJECT_ONE: ReadonlySet<string> = new Set(["p1"]);

function sharing(overrides: Partial<TemplateSharing>): TemplateSharing {
  return {
    departmentIds: [],
    projectIds: [],
    scope: TEMPLATE_SCOPE.PRIVATE,
    ...overrides,
  };
}

function template(overrides: Partial<TemplateSharing>): TemplateSharing & {
  readonly ownerId: string;
} {
  return { ownerId: "owner", ...sharing(overrides) };
}

describe("template visibility", () => {
  it("shows a private template to its owner and the administrator mode only", () => {
    const privateTemplate = template({});

    expect(
      policy.canView(
        createAccess({ userId: "owner" }),
        privateTemplate,
        NO_PROJECTS,
      ),
    ).toBe(true);
    expect(policy.canView(administrator, privateTemplate, NO_PROJECTS)).toBe(
      true,
    );
    expect(policy.canView(adminInRoleMode, privateTemplate, NO_PROJECTS)).toBe(
      false,
    );
    expect(policy.canView(writer, privateTemplate, NO_PROJECTS)).toBe(false);
    expect(policy.canView(inactive, privateTemplate, NO_PROJECTS)).toBe(false);
  });

  it("shows a template shared with all to every active account", () => {
    const shared = template({ scope: TEMPLATE_SCOPE.ALL });

    expect(policy.canView(writer, shared, NO_PROJECTS)).toBe(true);
    expect(policy.canView(inactive, shared, NO_PROJECTS)).toBe(false);
  });

  it("shows a department template to the members of those departments", () => {
    const shared = template({
      departmentIds: ["frontend"],
      scope: TEMPLATE_SCOPE.DEPARTMENTS,
    });
    const elsewhere = createAccess({
      departments: ["support"],
      userId: "elsewhere",
    });

    expect(policy.canView(writer, shared, NO_PROJECTS)).toBe(true);
    expect(policy.canView(elsewhere, shared, NO_PROJECTS)).toBe(false);
  });

  it("shows a project template to those who can open one of the projects", () => {
    const shared = template({
      projectIds: ["p1", "p2"],
      scope: TEMPLATE_SCOPE.PROJECTS,
    });

    expect(policy.canView(writer, shared, PROJECT_ONE)).toBe(true);
    expect(policy.canView(writer, shared, NO_PROJECTS)).toBe(false);
  });

  it("ignores shares that do not belong to the scope", () => {
    const leftover = template({
      departmentIds: ["frontend"],
      projectIds: ["p1"],
      scope: TEMPLATE_SCOPE.PRIVATE,
    });

    expect(policy.canView(writer, leftover, PROJECT_ONE)).toBe(false);
  });
});

describe("template management", () => {
  it("allows the owner and the administrator mode", () => {
    const owned = { ownerId: "writer" };

    expect(policy.canManage(writer, owned)).toBe(true);
    expect(policy.canManage(administrator, owned)).toBe(true);
    expect(policy.canManage(manager, owned)).toBe(false);
    expect(policy.canManage(adminInRoleMode, owned)).toBe(false);
  });

  it("denies an inactive owner", () => {
    expect(policy.canManage(inactive, { ownerId: "owner" })).toBe(false);
  });
});

describe("template sharing", () => {
  it("lets everyone share privately or with all", () => {
    expect(policy.canShare(writer, sharing({}), NO_PROJECTS)).toBe(true);
    expect(
      policy.canShare(
        writer,
        sharing({ scope: TEMPLATE_SCOPE.ALL }),
        NO_PROJECTS,
      ),
    ).toBe(true);
    expect(policy.canShare(inactive, sharing({}), NO_PROJECTS)).toBe(false);
  });

  it("limits department sharing to own and managed departments", () => {
    const share = (departmentIds: string[]): TemplateSharing =>
      sharing({ departmentIds, scope: TEMPLATE_SCOPE.DEPARTMENTS });

    expect(policy.canShare(writer, share(["frontend"]), NO_PROJECTS)).toBe(
      true,
    );
    expect(policy.canShare(writer, share(["backend"]), NO_PROJECTS)).toBe(
      false,
    );
    expect(
      policy.canShare(writer, share(["frontend", "backend"]), NO_PROJECTS),
    ).toBe(false);
    expect(policy.canShare(manager, share(["backend"]), NO_PROJECTS)).toBe(
      true,
    );
    expect(policy.canShare(manager, share(["support"]), NO_PROJECTS)).toBe(
      false,
    );
    expect(
      policy.canShare(administrator, share(["support"]), NO_PROJECTS),
    ).toBe(true);
    expect(policy.canShare(writer, share([]), NO_PROJECTS)).toBe(false);
  });

  it("limits project sharing to projects the account can open", () => {
    const share = (projectIds: string[]): TemplateSharing =>
      sharing({ projectIds, scope: TEMPLATE_SCOPE.PROJECTS });

    expect(policy.canShare(writer, share(["p1"]), PROJECT_ONE)).toBe(true);
    expect(policy.canShare(writer, share(["p1", "p2"]), PROJECT_ONE)).toBe(
      false,
    );
    expect(policy.canShare(writer, share(["p1"]), NO_PROJECTS)).toBe(false);
    expect(policy.canShare(writer, share([]), PROJECT_ONE)).toBe(false);
  });
});
