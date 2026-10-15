import { describe, expect, it } from "vitest";

import { TicketDepartmentPolicy } from "@/backend/auth/TicketDepartmentPolicy";
import { WorkItemTemplatePolicy } from "@/backend/auth/WorkItemTemplatePolicy";
import { isInAgentConnectionScope } from "@/backend/auth/AgentConnectionScopePolicy";
import { CAPABILITY } from "@/definition/Authorization";
import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";

import { accountFixture, administratorFixture } from "./account-fixture";

import type { AccountOptions } from "./account-fixture";
import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";

import type {
  AgentConnectionScope,
  AgentConnectionScopeTarget,
} from "@/definition/AgentConnectionScope";
import type { TemplateSharing } from "@/definition/WorkItemTemplate";

const templatePolicy = new WorkItemTemplatePolicy();

function sharing(overrides: Partial<TemplateSharing>): TemplateSharing {
  return {
    scope: TEMPLATE_SCOPE.PRIVATE,
    departmentIds: [],
    projectIds: [],
    ...overrides,
  };
}

describe("TicketDepartmentPolicy", () => {
  const policy = new TicketDepartmentPolicy();

  it("selects own departments even without management rights", () => {
    expect(
      policy.canSelect(accountFixture({ departments: ["sales"] }), "sales"),
    ).toBe(true);
    expect(
      policy.canSelect(accountFixture({ departments: ["sales"] }), "legal"),
    ).toBe(false);
  });

  it("selects managed or all departments only with project management", () => {
    const manager = accountFixture({
      permissions: [CAPABILITY.MANAGE_PROJECTS],
      managedDepartments: ["legal"],
    });
    const global = accountFixture({
      permissions: [CAPABILITY.MANAGE_PROJECTS],
      allDepartments: true,
    });
    const withoutRight = accountFixture({ managedDepartments: ["legal"] });

    expect(policy.canSelect(manager, "legal")).toBe(true);
    expect(policy.canSelect(manager, "sales")).toBe(false);
    expect(policy.canSelect(global, "anything")).toBe(true);
    expect(policy.canSelect(withoutRight, "legal")).toBe(false);
    expect(policy.canSelect(administratorFixture(), "anything")).toBe(true);
    expect(
      policy.canSelect(
        accountFixture({ isActive: false, departments: ["sales"] }),
        "sales",
      ),
    ).toBe(false);
  });
});

describe("WorkItemTemplatePolicy.canView", () => {
  const template = (
    overrides: Partial<TemplateSharing>,
  ): TemplateSharing & { readonly ownerId: string } => ({
    ...sharing(overrides),
    ownerId: "owner",
  });
  const noProjects = new Set<string>();

  it("shows a private template to its owner and the administrator only", () => {
    expect(
      templatePolicy.canView(
        accountFixture({ userId: "owner" }),
        template({}),
        noProjects,
      ),
    ).toBe(true);
    expect(
      templatePolicy.canView(administratorFixture(), template({}), noProjects),
    ).toBe(true);
    expect(
      templatePolicy.canView(
        accountFixture({ userId: "other" }),
        template({}),
        noProjects,
      ),
    ).toBe(false);
  });

  it("shows shared templates by audience", () => {
    const viewer = accountFixture({ userId: "viewer", departments: ["sales"] });
    const projects = new Set(["alpha"]);

    expect(
      templatePolicy.canView(
        viewer,
        template({ scope: TEMPLATE_SCOPE.ALL }),
        noProjects,
      ),
    ).toBe(true);
    expect(
      templatePolicy.canView(
        viewer,
        template({
          scope: TEMPLATE_SCOPE.DEPARTMENTS,
          departmentIds: ["sales"],
        }),
        noProjects,
      ),
    ).toBe(true);
    expect(
      templatePolicy.canView(
        viewer,
        template({
          scope: TEMPLATE_SCOPE.DEPARTMENTS,
          departmentIds: ["legal"],
        }),
        noProjects,
      ),
    ).toBe(false);
    expect(
      templatePolicy.canView(
        viewer,
        template({ scope: TEMPLATE_SCOPE.PROJECTS, projectIds: ["alpha"] }),
        projects,
      ),
    ).toBe(true);
    expect(
      templatePolicy.canView(
        viewer,
        template({ scope: TEMPLATE_SCOPE.PROJECTS, projectIds: ["beta"] }),
        projects,
      ),
    ).toBe(false);
  });

  it("shows nothing to an inactive account, not even to its owner", () => {
    expect(
      templatePolicy.canView(
        accountFixture({ userId: "owner", isActive: false }),
        template({ scope: TEMPLATE_SCOPE.ALL }),
        noProjects,
      ),
    ).toBe(false);
  });
});

describe("WorkItemTemplatePolicy.canManage and canShare", () => {
  it("manages as owner or administrator while active", () => {
    const owned = { ownerId: "owner" };

    expect(
      templatePolicy.canManage(accountFixture({ userId: "owner" }), owned),
    ).toBe(true);
    expect(templatePolicy.canManage(administratorFixture(), owned)).toBe(true);
    expect(
      templatePolicy.canManage(accountFixture({ userId: "other" }), owned),
    ).toBe(false);
    expect(
      templatePolicy.canManage(
        accountFixture({ userId: "owner", isActive: false }),
        owned,
      ),
    ).toBe(false);
  });

  it("shares privately and with all without further conditions", () => {
    const actor = accountFixture();

    expect(templatePolicy.canShare(actor, sharing({}), new Set())).toBe(true);
    expect(
      templatePolicy.canShare(
        actor,
        sharing({ scope: TEMPLATE_SCOPE.ALL }),
        new Set(),
      ),
    ).toBe(true);
    expect(
      templatePolicy.canShare(
        accountFixture({ isActive: false }),
        sharing({}),
        new Set(),
      ),
    ).toBe(false);
  });

  it("shares with departments the actor may select and at least one", () => {
    const actor = accountFixture({ departments: ["sales"] });
    const toDepartments = (departmentIds: string[]): TemplateSharing =>
      sharing({ scope: TEMPLATE_SCOPE.DEPARTMENTS, departmentIds });

    expect(
      templatePolicy.canShare(actor, toDepartments(["sales"]), new Set()),
    ).toBe(true);
    expect(templatePolicy.canShare(actor, toDepartments([]), new Set())).toBe(
      false,
    );
    expect(
      templatePolicy.canShare(
        actor,
        toDepartments(["sales", "legal"]),
        new Set(),
      ),
    ).toBe(false);
  });

  it("shares with projects the actor may open and at least one", () => {
    const actor = accountFixture();
    const opened = new Set(["alpha"]);
    const toProjects = (projectIds: string[]): TemplateSharing =>
      sharing({ scope: TEMPLATE_SCOPE.PROJECTS, projectIds });

    expect(templatePolicy.canShare(actor, toProjects(["alpha"]), opened)).toBe(
      true,
    );
    expect(templatePolicy.canShare(actor, toProjects([]), opened)).toBe(false);
    expect(
      templatePolicy.canShare(actor, toProjects(["alpha", "beta"]), opened),
    ).toBe(false);
  });
});

describe("isInAgentConnectionScope", () => {
  const viewer = (overrides: AccountOptions = {}): AgentViewer => ({
    actor: accountFixture({ userId: "person", ...overrides }),
    groupIds: ["group-a"],
  });
  const restricted = (
    ...targets: AgentConnectionScopeTarget[]
  ): AgentConnectionScope => ({ mode: "restricted", targets });

  it("admits every active account to a global scope", () => {
    expect(
      isInAgentConnectionScope({ mode: "global", targets: [] }, viewer()),
    ).toBe(true);
    expect(
      isInAgentConnectionScope(
        { mode: "global", targets: [] },
        viewer({ isActive: false }),
      ),
    ).toBe(false);
  });

  it("admits one matching person, group or department", () => {
    expect(
      isInAgentConnectionScope(
        restricted({ kind: "person", targetId: "person" }),
        viewer(),
      ),
    ).toBe(true);
    expect(
      isInAgentConnectionScope(
        restricted({ kind: "group", targetId: "group-a" }),
        viewer(),
      ),
    ).toBe(true);
    expect(
      isInAgentConnectionScope(
        restricted({ kind: "department", targetId: "sales" }),
        viewer({ departments: ["sales"] }),
      ),
    ).toBe(true);
  });

  it("refuses non-members, also administrators and department managers", () => {
    const scope = restricted(
      { kind: "person", targetId: "someone" },
      { kind: "group", targetId: "group-b" },
      { kind: "department", targetId: "sales" },
    );

    expect(isInAgentConnectionScope(scope, viewer())).toBe(false);
    expect(
      isInAgentConnectionScope(
        scope,
        viewer({ managedDepartments: ["sales"], isAdmin: true, mode: "admin" }),
      ),
    ).toBe(false);
    expect(
      isInAgentConnectionScope({ mode: "restricted", targets: [] }, viewer()),
    ).toBe(false);
  });
});
