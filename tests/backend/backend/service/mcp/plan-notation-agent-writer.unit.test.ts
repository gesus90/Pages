import { describe, expect, it } from "vitest";

import {
  planNotationAgentEntries,
  planNotationTargetEntries,
} from "@/backend/service/mcp/plan/PlanNotationAgentWriter";
import { PlanNotationNames } from "@/backend/service/mcp/plan/PlanNotationNames";
import { agent, planOf } from "../../../definition/plan-fixtures";

import type { PlanNotationCatalog } from "@/backend/service/mcp/plan/PlanNotationNames";

const CATALOG: PlanNotationCatalog = {
  workspaces: [],
  sources: { agents: [], tasks: [] },
  wikiPages: [],
};
const names = new PlanNotationNames(CATALOG);
const context = { names, sources: CATALOG.sources, plan: planOf([]) };

describe("plan notation agent writer", () => {
  it("writes local targets and preserves unresolved remote identifiers as JSON", () => {
    expect(planNotationTargetEntries(undefined, names)).toEqual([]);
    expect(planNotationTargetEntries({ kind: "local" }, names)).toEqual([
      { key: "target", value: "local" },
    ]);
    expect(
      planNotationTargetEntries(
        { kind: "remote", workspaceId: "remote-1" },
        names,
      ),
    ).toEqual([
      {
        key: "executionTarget",
        value: '"{\\"kind\\":\\"remote\\",\\"workspaceId\\":\\"remote-1\\"}"',
      },
    ]);
  });

  it("writes explicit identifiers, instructions, completion and listable checks", () => {
    const step = {
      ...agent("worker"),
      personalAgentId: "personal-1",
      instruction: "Do work",
      completion: "todos" as const,
      completionGate: { version: 1 as const, requiredChecks: ["lint", "test"] },
    };
    expect(planNotationAgentEntries(step, context)).toEqual([
      { key: "agentId", value: '"agent-1"' },
      { key: "personalAgentId", value: '"personal-1"' },
      { key: "instruction", value: '"Do work"' },
      { key: "completion", value: "todos" },
      { key: "checks", value: '"lint,test"' },
    ]);
  });

  it("keeps checks containing commas or whitespace in the JSON form", () => {
    const step = {
      ...agent("worker"),
      completionGate: {
        version: 1 as const,
        requiredChecks: [" check", "a,b"],
      },
    };
    expect(planNotationAgentEntries(step, context)).toEqual([
      { key: "agentId", value: '"agent-1"' },
      {
        key: "completionGate",
        value:
          '"{\\"version\\":1,\\"requiredChecks\\":[\\" check\\",\\"a,b\\"]}"',
      },
    ]);
  });
});
