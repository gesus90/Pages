import { describe, expect, it, vi } from "vitest";

import { AgentProfileStore } from "@/backend/database/repositories/agent/AgentProfileStore";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { AgentProfile } from "@/definition/AgentProfile";

function profile(overrides: Partial<AgentProfile>): AgentProfile {
  return {
    id: "profile",
    name: "Profile",
    connectionId: "connection",
    model: "model",
    reasoningEffort: null,
    isActive: true,
    purposes: ["text"],
    targets: [],
    ...overrides,
  };
}

describe("A11.10 g4: agents that reference a group", () => {
  it("names agents by their scope and by their usage sharing, including agents without a configuration", async () => {
    const store = new AgentProfileStore({
      query: vi.fn(),
      execute: vi.fn(),
    });
    const sharing = {
      ...emptyAgentConfiguration("system"),
      sharing: {
        isGlobal: false,
        targets: [{ kind: "group" as const, targetId: "design" }],
      },
    };
    const unrelated = {
      ...emptyAgentConfiguration("system"),
      sharing: {
        isGlobal: false,
        targets: [{ kind: "person" as const, targetId: "design" }],
      },
    };
    vi.spyOn(store, "list").mockResolvedValueOnce([
      profile({
        id: "scoped",
        name: "Scoped legacy agent",
        targets: [{ kind: "group", targetId: "design" }],
      }),
      profile({
        id: "legacy-other",
        name: "Legacy agent of another group",
        targets: [{ kind: "group", targetId: "other" }],
      }),
      profile({ id: "shared", name: "Shared agent", configuration: sharing }),
      profile({
        id: "person",
        name: "Agent shared with a person",
        configuration: unrelated,
      }),
    ]);

    expect(
      await store.references({ kind: "group", targetId: "design" }),
    ).toEqual([
      { id: "scoped", name: "Scoped legacy agent" },
      { id: "shared", name: "Shared agent" },
    ]);
  });
});

describe("A11.10 g4: where an agent is used", () => {
  it("lists assignments, sharing, global use, project, legacy functions and plans", async () => {
    const configuration = {
      ...emptyAgentConfiguration("person"),
      projectId: "project-1",
      sharing: {
        isGlobal: true,
        targets: [{ kind: "group" as const, targetId: "design" }],
      },
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        [
          "agent",
          "Agent",
          "connection",
          "model",
          null,
          1,
          JSON.stringify(configuration),
          1,
        ],
      ])
      .mockResolvedValueOnce([["agent", "text"]])
      .mockResolvedValueOnce([["agent", "person", "alice"]])
      .mockResolvedValueOnce([["chat"]])
      .mockResolvedValueOnce([["plan-1"]]);
    const store = new AgentProfileStore({ query, execute: vi.fn() });

    expect(await store.usages("agent")).toEqual([
      { kind: "assignment", target: { kind: "person", targetId: "alice" } },
      { kind: "sharing", target: { kind: "group", targetId: "design" } },
      { kind: "global" },
      { kind: "project", id: "project-1" },
      { kind: "legacy", id: "chat" },
      { kind: "plan", id: "plan-1" },
    ]);
  });
});
