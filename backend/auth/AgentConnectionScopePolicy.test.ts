import { expect, it } from "vitest";

import { isInAgentConnectionScope } from "./AgentConnectionScopePolicy";

import type { AgentViewer } from "./AgentProfilePolicy";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentConnectionScope } from "@/definition/AgentConnectionScope";

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

function viewer(
  actor: Partial<AccountAccess> = {},
  groupIds: readonly string[] = [],
): AgentViewer {
  return { actor: account(actor), groupIds };
}

const restricted = (
  targets: AgentConnectionScope["targets"],
): AgentConnectionScope => ({ mode: "restricted", targets });

it("admits every active account of a global connection", () => {
  expect(
    isInAgentConnectionScope({ mode: "global", targets: [] }, viewer()),
  ).toBe(true);
});

it("never admits an inactive account, even to a global connection", () => {
  expect(
    isInAgentConnectionScope(
      { mode: "global", targets: [] },
      viewer({ isActive: false }),
    ),
  ).toBe(false);
});

it("admits the named person only", () => {
  const scope = restricted([{ kind: "person", targetId: "user-1" }]);

  expect(isInAgentConnectionScope(scope, viewer({ userId: "user-1" }))).toBe(
    true,
  );
  expect(isInAgentConnectionScope(scope, viewer({ userId: "user-2" }))).toBe(
    false,
  );
});

it("admits members of the named group through their group identifiers", () => {
  const scope = restricted([{ kind: "group", targetId: "group-a" }]);

  expect(isInAgentConnectionScope(scope, viewer({}, ["group-a"]))).toBe(true);
  expect(isInAgentConnectionScope(scope, viewer({}, ["group-b"]))).toBe(false);
});

it("admits department members by membership only, not by managing the department", () => {
  const scope = restricted([{ kind: "department", targetId: "dept-a" }]);

  expect(
    isInAgentConnectionScope(scope, viewer({ departments: ["dept-a"] })),
  ).toBe(true);
  expect(
    isInAgentConnectionScope(
      scope,
      viewer({ managedDepartments: ["dept-a"], allDepartments: true }),
    ),
  ).toBe(false);
});

it("passes when any one target matches", () => {
  const scope = restricted([
    { kind: "person", targetId: "user-9" },
    { kind: "group", targetId: "group-a" },
  ]);

  expect(isInAgentConnectionScope(scope, viewer({}, ["group-a"]))).toBe(true);
});

it("gives an administrator no exception on a restricted connection", () => {
  const scope = restricted([{ kind: "person", targetId: "user-9" }]);
  const administrator = viewer({ isAdmin: true, mode: "admin" });

  expect(isInAgentConnectionScope(scope, administrator)).toBe(false);
});

it("admits nobody on a restricted connection without targets", () => {
  expect(isInAgentConnectionScope(restricted([]), viewer())).toBe(false);
});
