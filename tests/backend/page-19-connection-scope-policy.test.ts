import { describe, expect, it, vi } from "vitest";

import { isInAgentConnectionScope } from "@/backend/auth/AgentConnectionScopePolicy";
import { ScopedExecution } from "@/backend/agents/ScopedExecution";
import { readAgentConnectionScope } from "@/backend/service/agents/AgentConnectionValidation";
import {
  GLOBAL_CONNECTION_SCOPE,
  isAgentConnectionScopeKind,
  isAgentConnectionScopeMode,
} from "@/definition/AgentConnectionScope";

import { createAccess } from "../helpers/authorization";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { AgentConnectionScope } from "@/definition/AgentConnectionScope";

function viewer(
  overrides: Partial<AgentViewer["actor"]> = {},
  groups: string[] = [],
) {
  return {
    actor: createAccess({
      userId: "person",
      departments: [],
      managedDepartments: [],
      ...overrides,
    }),
    groupIds: groups,
  } satisfies AgentViewer;
}

describe("PAGE-19 scope policy", () => {
  it("admits every active account to a global scope and no inactive one", () => {
    expect(isInAgentConnectionScope(GLOBAL_CONNECTION_SCOPE, viewer())).toBe(
      true,
    );
    expect(
      isInAgentConnectionScope(
        GLOBAL_CONNECTION_SCOPE,
        viewer({ isActive: false }),
      ),
    ).toBe(false);
  });

  it("matches a person, a group and a department, and one match is enough", () => {
    const scope: AgentConnectionScope = {
      mode: "restricted",
      targets: [
        { kind: "person", targetId: "someone" },
        { kind: "group", targetId: "team" },
        { kind: "department", targetId: "engineering" },
      ],
    };
    expect(isInAgentConnectionScope(scope, viewer({ userId: "someone" }))).toBe(
      true,
    );
    expect(isInAgentConnectionScope(scope, viewer({}, ["team"]))).toBe(true);
    expect(
      isInAgentConnectionScope(scope, viewer({ departments: ["engineering"] })),
    ).toBe(true);
    expect(
      isInAgentConnectionScope(
        scope,
        viewer({ userId: "someone", isActive: false }),
      ),
    ).toBe(false);
  });

  it("does not match by name, by management range or by a similar identifier", () => {
    const scope: AgentConnectionScope = {
      mode: "restricted",
      targets: [
        { kind: "group", targetId: "team" },
        { kind: "department", targetId: "engineering" },
      ],
    };
    expect(
      isInAgentConnectionScope(
        scope,
        viewer({
          managedDepartments: ["engineering"],
          allDepartments: true,
          allProjects: true,
          isAdmin: true,
          mode: "admin",
        }),
      ),
    ).toBe(false);
    expect(
      isInAgentConnectionScope(scope, viewer({}, ["Team", "team-2"])),
    ).toBe(false);
    expect(
      isInAgentConnectionScope(
        { mode: "restricted", targets: [] },
        viewer({ userId: "" }),
      ),
    ).toBe(false);
  });
});

describe("PAGE-19 scope input and kinds", () => {
  it("narrows modes and kinds without accepting a system function", () => {
    expect(
      ["global", "restricted"].every((mode) =>
        isAgentConnectionScopeMode(mode),
      ),
    ).toBe(true);
    expect(isAgentConnectionScopeMode("everybody")).toBe(false);
    expect(isAgentConnectionScopeMode(undefined)).toBe(false);
    expect(
      ["person", "group", "department"].every((kind) =>
        isAgentConnectionScopeKind(kind),
      ),
    ).toBe(true);
    expect(isAgentConnectionScopeKind("system")).toBe(false);
    expect(isAgentConnectionScopeKind(null)).toBe(false);
  });

  it("reads a scope once per target and ignores nothing silently", () => {
    expect(readAgentConnectionScope({ mode: "global" })).toBe(
      GLOBAL_CONNECTION_SCOPE,
    );
    expect(
      readAgentConnectionScope({
        mode: "restricted",
        targets: [
          { kind: "person", targetId: " a " },
          { kind: "person", targetId: "a" },
          { kind: "group", targetId: "a" },
        ],
      }),
    ).toEqual({
      mode: "restricted",
      targets: [
        { kind: "person", targetId: "a" },
        { kind: "group", targetId: "a" },
      ],
    });
    for (const invalid of [
      undefined,
      "global",
      {
        mode: "restricted",
        targets: [{ kind: "person", targetId: "a\u0000" }],
      },
      {
        mode: "restricted",
        targets: [{ kind: "person", targetId: "x".repeat(101) }],
      },
    ])
      expect(() => readAgentConnectionScope(invalid)).toThrow();
  });
});

describe("PAGE-19 execution guard", () => {
  const input: TextExecutionInput = {
    userId: "person",
    prompt: "Prompt",
    agent: {
      model: "model-a",
      reasoningEffort: null,
      connection: {
        isActive: true,
        id: "connection",
        name: "Synthetic",
        provider: "openai",
        hasApiKey: true,
        testModel: null,
        reasoningEffort: null,
        cliLoggedInAt: null,
        cliAccountLabel: null,
        updatedAt: "now",
      },
    },
  };

  it("authorizes the named person for the connection before running", async () => {
    const order: string[] = [];
    const inner = {
      run: vi.fn(async () => {
        order.push("run");
        return "answer";
      }),
    };
    const authorizer = {
      requireUser: vi.fn(async () => {
        order.push("authorize");
      }),
    };
    const result = await new ScopedExecution(inner, authorizer).run(
      input,
      new AbortController().signal,
    );
    expect(result).toBe("answer");
    expect(order).toEqual(["authorize", "run"]);
    expect(authorizer.requireUser).toHaveBeenCalledWith("person", "connection");
  });

  it("never enters the wrapped execution after a refusal", async () => {
    const inner = { run: vi.fn(async () => "answer") };
    const authorizer = {
      requireUser: vi.fn().mockRejectedValue(new Error("accessDenied")),
    };
    await expect(
      new ScopedExecution(inner, authorizer).run(
        input,
        new AbortController().signal,
      ),
    ).rejects.toThrow("accessDenied");
    expect(inner.run).not.toHaveBeenCalled();
  });
});
