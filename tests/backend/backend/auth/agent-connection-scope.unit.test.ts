import { describe, expect, it } from "vitest";

import { isInAgentConnectionScope } from "@/backend/auth/AgentConnectionScopePolicy";
import {
  GLOBAL_CONNECTION_SCOPE,
  UNSET_CONNECTION_SCOPE,
} from "@/definition/AgentConnectionScope";
import { CAPABILITY } from "@/definition/Authorization";

import { accountFixture, administratorFixture } from "./account-fixture";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionScopeTarget } from "@/definition/AgentConnectionScope";

const viewer: AgentViewer = {
  actor: accountFixture({ userId: "person", departments: ["sales"] }),
  groupIds: ["editors"],
};

function canUse(
  targets: readonly AgentConnectionScopeTarget[],
  current: AgentViewer = viewer,
): boolean {
  return isInAgentConnectionScope({ mode: "restricted", targets }, current);
}

describe("connection model usage scope", () => {
  it("admits active accounts globally and fails closed for an unset scope", () => {
    expect(isInAgentConnectionScope(GLOBAL_CONNECTION_SCOPE, viewer)).toBe(
      true,
    );
    expect(isInAgentConnectionScope(UNSET_CONNECTION_SCOPE, viewer)).toBe(
      false,
    );
  });

  it.each(["global", "restricted"] as const)(
    "refuses inactive administrators for %s connections",
    (mode) => {
      const inactive: AgentViewer = {
        actor: administratorFixture({ isActive: false }),
        groupIds: ["editors"],
      };

      expect(
        isInAgentConnectionScope(
          { mode, targets: [{ kind: "group", targetId: "editors" }] },
          inactive,
        ),
      ).toBe(false);
    },
  );

  it.each<AgentConnectionScopeTarget>([
    { kind: "person", targetId: "person" },
    { kind: "group", targetId: "editors" },
    { kind: "department", targetId: "sales" },
  ])("admits a matching $kind target", (target) => {
    expect(canUse([target])).toBe(true);
    expect(canUse([{ ...target, targetId: "other" }])).toBe(false);
  });

  it("combines targets with OR and reads current membership on each check", () => {
    const targets: readonly AgentConnectionScopeTarget[] = [
      { kind: "person", targetId: "other" },
      { kind: "group", targetId: "editors" },
    ];

    expect(canUse(targets)).toBe(true);
    expect(canUse(targets, { ...viewer, groupIds: [] })).toBe(false);
  });

  it("grants no model usage through administration or managed departments", () => {
    const targets: readonly AgentConnectionScopeTarget[] = [
      { kind: "department", targetId: "sales" },
    ];
    const manager: AgentViewer = {
      actor: accountFixture({
        permissions: [CAPABILITY.MANAGE_USERS],
        managedDepartments: ["sales"],
      }),
      groupIds: [],
    };

    expect(canUse(targets, manager)).toBe(false);
    expect(
      canUse(targets, {
        actor: administratorFixture(),
        groupIds: [],
      }),
    ).toBe(false);
  });
});
