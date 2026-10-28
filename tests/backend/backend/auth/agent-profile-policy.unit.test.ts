import { expect, it } from "vitest";

import {
  agentProfilePriority,
  hasAgentUsage,
  matchesAgentTarget,
} from "@/backend/auth/AgentProfilePolicy";
import { CAPABILITY } from "@/definition/Authorization";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { accountFixture } from "./account-fixture";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type {
  AgentProfile,
  AgentProfileTarget,
} from "@/definition/AgentProfile";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";

const VIEWER: AgentViewer = {
  actor: accountFixture({ userId: "user-1", departments: ["sales"] }),
  groupIds: ["group-1"],
};

const MANAGER: AgentViewer = {
  actor: accountFixture({
    userId: "manager",
    permissions: [CAPABILITY.MANAGE_USERS],
    managedDepartments: ["support"],
  }),
  groupIds: [],
};

function profile(
  targets: readonly AgentProfileTarget[],
  sharing?: AgentConfiguration["sharing"],
): AgentProfile {
  return {
    id: "profile-1",
    name: "Synthetic agent",
    connectionId: "connection-1",
    model: "model-1",
    reasoningEffort: null,
    isActive: true,
    purposes: ["agent"],
    targets,
    ownerId: "owner",
    ...(sharing === undefined
      ? {}
      : { configuration: { ...emptyAgentConfiguration(), sharing } }),
  };
}

it("matches person, group, department and system targets", () => {
  expect(
    matchesAgentTarget({ kind: "person", targetId: "user-1" }, VIEWER),
  ).toBe(true);
  expect(
    matchesAgentTarget({ kind: "group", targetId: "group-2" }, VIEWER),
  ).toBe(false);
  expect(
    matchesAgentTarget({ kind: "department", targetId: "sales" }, VIEWER),
  ).toBe(true);
  expect(matchesAgentTarget({ kind: "system", targetId: "chat" }, VIEWER)).toBe(
    true,
  );
});

it("grants managed departments only to account managers", () => {
  const target: AgentProfileTarget = {
    kind: "department",
    targetId: "support",
  };
  expect(matchesAgentTarget(target, MANAGER)).toBe(true);
  expect(
    matchesAgentTarget(target, {
      actor: { ...MANAGER.actor, role: null },
      groupIds: [],
    }),
  ).toBe(false);
});

it("prioritizes the closest matching target for the requested purpose", () => {
  const targets: AgentProfileTarget[] = [
    { kind: "system", targetId: "chat" },
    { kind: "department", targetId: "sales" },
    { kind: "group", targetId: "group-1" },
  ];
  expect(agentProfilePriority(profile(targets), VIEWER, "agent")).toBe(3);
  expect(
    agentProfilePriority(
      profile([{ kind: "system", targetId: "chat" }]),
      VIEWER,
      "agent",
    ),
  ).toBe(0);
});

it("lets the owner use the agent and falls back to targets without sharing", () => {
  expect(
    hasAgentUsage(profile([]), {
      ...VIEWER,
      actor: accountFixture({ userId: "owner" }),
    }),
  ).toBe(true);
  expect(
    hasAgentUsage(profile([{ kind: "group", targetId: "group-1" }]), VIEWER),
  ).toBe(true);
  expect(hasAgentUsage(profile([]), VIEWER)).toBe(false);
});

it("applies global, empty, AND and OR sharing without managed departments", () => {
  const sales: AgentProfileTarget = { kind: "department", targetId: "sales" };
  const other: AgentProfileTarget = { kind: "group", targetId: "group-9" };
  const support: AgentProfileTarget = {
    kind: "department",
    targetId: "support",
  };
  expect(
    hasAgentUsage(profile([], { isGlobal: true, targets: [] }), VIEWER),
  ).toBe(true);
  expect(
    hasAgentUsage(profile([], { isGlobal: false, targets: [] }), VIEWER),
  ).toBe(false);
  expect(
    hasAgentUsage(
      profile([], { isGlobal: false, targets: [sales, other] }),
      VIEWER,
    ),
  ).toBe(true);
  expect(
    hasAgentUsage(
      profile([], {
        isGlobal: false,
        targets: [sales, other],
        operator: "and",
      }),
      VIEWER,
    ),
  ).toBe(false);
  expect(
    hasAgentUsage(
      profile([], { isGlobal: false, targets: [support] }),
      MANAGER,
    ),
  ).toBe(false);
});
