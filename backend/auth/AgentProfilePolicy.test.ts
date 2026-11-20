import { expect, it } from "vitest";

import {
  agentProfilePriority,
  hasAgentUsage,
  matchesAgentTarget,
} from "./AgentProfilePolicy";

import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { AgentViewer } from "./AgentProfilePolicy";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type {
  AgentProfile,
  AgentProfileTarget,
} from "@/definition/AgentProfile";
import type { AccountAccess, UserRole } from "@/definition/Authorization";

const managerRole: UserRole = {
  id: "role-manager",
  name: "Manager",
  rank: 2,
  departmentBound: false,
  permissions: ["manage_users"],
};

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

function profile(
  targets: readonly AgentProfileTarget[],
  overrides: Partial<AgentProfile> = {},
): AgentProfile {
  return {
    id: "agent-1",
    name: "Assistant",
    connectionId: "connection-1",
    model: "model-1",
    reasoningEffort: null,
    isActive: true,
    purposes: ["chat", "agent"],
    targets,
    ...overrides,
  };
}

function sharedProfile(
  sharing: AgentConfiguration["sharing"],
  overrides: Partial<AgentProfile> = {},
): AgentProfile {
  return profile([], {
    ownerId: "owner-1",
    configuration: { ...emptyAgentConfiguration(), sharing },
    ...overrides,
  });
}

it("matches a person target only against the account itself", () => {
  const target: AgentProfileTarget = { kind: "person", targetId: "user-1" };

  expect(matchesAgentTarget(target, viewer({ userId: "user-1" }))).toBe(true);
  expect(matchesAgentTarget(target, viewer({ userId: "user-2" }))).toBe(false);
});

it("matches a group target through the group identifiers of the viewer", () => {
  const target: AgentProfileTarget = { kind: "group", targetId: "group-a" };

  expect(matchesAgentTarget(target, viewer({}, ["group-a"]))).toBe(true);
  expect(matchesAgentTarget(target, viewer({}, ["group-b"]))).toBe(false);
});

it("matches a department target by membership or by a managed department with user management", () => {
  const target: AgentProfileTarget = { kind: "department", targetId: "dept-a" };

  expect(matchesAgentTarget(target, viewer({ departments: ["dept-a"] }))).toBe(
    true,
  );
  expect(
    matchesAgentTarget(
      target,
      viewer({ role: managerRole, managedDepartments: ["dept-a"] }),
    ),
  ).toBe(true);
  expect(
    matchesAgentTarget(target, viewer({ managedDepartments: ["dept-a"] })),
  ).toBe(false);
});

it("does not grant a department through management without the user management permission", () => {
  const target: AgentProfileTarget = { kind: "department", targetId: "dept-a" };
  const roleWithoutUserManagement: UserRole = {
    ...managerRole,
    permissions: [],
  };

  expect(
    matchesAgentTarget(
      target,
      viewer({
        role: roleWithoutUserManagement,
        managedDepartments: ["dept-a"],
      }),
    ),
  ).toBe(false);
});

it("matches the system target for every viewer", () => {
  expect(
    matchesAgentTarget({ kind: "system", targetId: "agent" }, viewer()),
  ).toBe(true);
});

it("ranks the most specific matching target first and ignores non-matching ones", () => {
  const priorityProfile = profile([
    { kind: "department", targetId: "dept-a" },
    { kind: "group", targetId: "group-a" },
    { kind: "person", targetId: "user-1" },
  ]);
  const member = viewer({ userId: "user-9", departments: ["dept-a"] }, [
    "group-a",
  ]);

  expect(agentProfilePriority(priorityProfile, member, "agent")).toBe(3);
  expect(
    agentProfilePriority(
      priorityProfile,
      viewer({ userId: "user-1" }),
      "agent",
    ),
  ).toBe(4);
  expect(
    agentProfilePriority(
      priorityProfile,
      viewer({ userId: "user-9" }),
      "agent",
    ),
  ).toBe(0);
});

it("counts the system target only for its own purpose", () => {
  const systemProfile = profile([{ kind: "system", targetId: "chat" }]);

  expect(agentProfilePriority(systemProfile, viewer(), "chat")).toBe(1);
  expect(agentProfilePriority(systemProfile, viewer(), "agent")).toBe(0);
});

it("lets the owner use the agent regardless of its sharing", () => {
  const owned = sharedProfile({
    isGlobal: false,
    targets: [],
    operator: "and",
  });

  expect(hasAgentUsage(owned, viewer({ userId: "owner-1" }))).toBe(true);
});

it("uses targets for usage when the agent has no configuration", () => {
  const targeted = profile([{ kind: "person", targetId: "user-2" }]);

  expect(hasAgentUsage(targeted, viewer({ userId: "user-2" }))).toBe(true);
  expect(hasAgentUsage(targeted, viewer({ userId: "user-3" }))).toBe(false);
});

it("grants usage without configuration through a system target for agents", () => {
  const systemProfile = profile([{ kind: "system", targetId: "agent" }]);

  expect(hasAgentUsage(systemProfile, viewer())).toBe(true);
});

it("shares an agent with everyone when the sharing is global", () => {
  const globalProfile = sharedProfile({
    isGlobal: true,
    targets: [],
  });

  expect(hasAgentUsage(globalProfile, viewer())).toBe(true);
});

it("denies usage of a non-global share without targets", () => {
  const emptyShare = sharedProfile({ isGlobal: false, targets: [] });

  expect(hasAgentUsage(emptyShare, viewer())).toBe(false);
});

it("accepts one matching target with the default OR operator", () => {
  const share = sharedProfile({
    isGlobal: false,
    targets: [
      { kind: "group", targetId: "group-a" },
      { kind: "department", targetId: "dept-a" },
    ],
  });

  expect(hasAgentUsage(share, viewer({}, ["group-a"]))).toBe(true);
  expect(hasAgentUsage(share, viewer())).toBe(false);
});

it("requires every target with the AND operator", () => {
  const share = sharedProfile({
    isGlobal: false,
    operator: "and",
    targets: [
      { kind: "group", targetId: "group-a" },
      { kind: "department", targetId: "dept-a" },
    ],
  });

  expect(
    hasAgentUsage(share, viewer({ departments: ["dept-a"] }, ["group-a"])),
  ).toBe(true);
  expect(hasAgentUsage(share, viewer({}, ["group-a"]))).toBe(false);
});

it("ignores managed departments when deciding usage", () => {
  const share = sharedProfile({
    isGlobal: false,
    targets: [{ kind: "department", targetId: "dept-a" }],
  });
  const manager = viewer({
    role: managerRole,
    managedDepartments: ["dept-a"],
  });

  expect(hasAgentUsage(share, manager)).toBe(false);
});
