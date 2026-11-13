import { describe, expect, it } from "vitest";

import {
  jsonEntry,
  planNotationAttributeList,
  planNotationJson,
  planNotationNumber,
  planNotationWord,
  quotedPlanNotation,
  textEntry,
  wordEntry,
} from "@/backend/service/mcp/plan/PlanNotationFormat";
import { previewPlanNotation } from "@/backend/service/mcp/plan/PlanNotationPreview";
import { writePlanNotation } from "@/backend/service/mcp/plan/PlanNotationWriter";
import {
  agent,
  boundary,
  edge,
  groupOf,
  loopOf,
  planOf,
  script,
} from "../../../definition/plan-fixtures";

import type { PlanNotationCatalog } from "@/backend/service/mcp/plan/PlanNotationNames";
import type { AgentPlanEdge } from "@/definition/AgentPlan";

const CATALOG: PlanNotationCatalog = {
  workspaces: [],
  sources: { agents: [], tasks: [] },
  wikiPages: [],
};

describe("plan notation formatting", () => {
  it("escapes text and quotes words that cannot be identifiers", () => {
    expect(quotedPlanNotation('a\\b"c\nd')).toBe('"a\\\\b\\"c\\nd"');
    expect(planNotationWord("Größe_2.x")).toBe("Größe_2.x");
    expect(planNotationWord("graph")).toBe('"graph"');
    expect(planNotationWord("two words")).toBe('"two words"');
    expect(planNotationNumber(-12.5)).toBe("-12.5");
    expect(planNotationNumber(1e21)).toBe('"1e+21"');
    expect(planNotationJson({ text: 'a"b' })).toBe(
      '"{\\"text\\":\\"a\\\\\\"b\\"}"',
    );
  });

  it("writes ordered attributes and omits an empty list", () => {
    expect(planNotationAttributeList([])).toBe("");
    expect(
      planNotationAttributeList([
        wordEntry("kind", "start"),
        textEntry("name", "A B"),
        jsonEntry("items", [1, 2]),
      ]),
    ).toBe(' [kind=start, name="A B", items="[1,2]"]');
  });
});

describe("plan notation preview", () => {
  it("reports fields and container moves while ignoring positions", () => {
    const stored = planOf([
      agent("move"),
      agent("removed"),
      groupOf("group", []),
    ]);
    const proposed = planOf([
      groupOf("group", [{ ...agent("move"), instruction: "new", x: 42 }]),
      agent("added"),
    ]);
    expect(previewPlanNotation(stored, proposed)).toEqual({
      nodes: { added: ["added"], changed: ["move"], removed: ["removed"] },
      edges: { added: [], removed: [] },
      fields: [
        { nodeId: "move", field: "instruction" },
        { nodeId: "move", field: "container" },
      ],
    });
  });

  it("counts repeated edges across outer plans and loops", () => {
    const connection = edge("a", "b");
    const oldPlan = planOf(
      [loopOf("loop", [agent("a"), agent("b")], [connection])],
      [connection, connection],
    );
    const newPlan = planOf(
      [loopOf("loop", [agent("a"), agent("b")], [])],
      [connection],
    );
    expect(previewPlanNotation(oldPlan, newPlan).edges).toEqual({
      added: [],
      removed: [connection, connection],
    });
    expect(previewPlanNotation(newPlan, oldPlan).edges).toEqual({
      added: [connection, connection],
      removed: [],
    });
  });
});

describe("plan notation writer", () => {
  it("writes plan attributes, nodes, edge kinds, and unknown ports", () => {
    const connections: AgentPlanEdge[] = [
      { from: "start", to: "choose", fromPort: "flow-out", toPort: "flow-in" },
      { from: "choose", to: "end", fromPort: "true-out", toPort: "flow-in" },
      { from: "choose", to: "end", fromPort: "case:other", toPort: "flow-in" },
      {
        from: "worker",
        to: "choose",
        fromPort: "passed-out",
        toPort: "condition-in",
      },
      {
        from: "worker",
        to: "worker",
        fromPort: "value-out",
        toPort: "event-in",
      },
      edge("start", "end"),
    ];
    const plan = {
      ...planOf(
        [boundary("start", "start"), boundary("end", "end")],
        connections,
      ),
      name: 'A "plan"',
      globals: { greeting: "hello\nworld" },
    };
    const notation = writePlanNotation(plan, CATALOG);
    expect(notation).toContain('digraph "A \\"plan\\"" {');
    expect(notation).toContain('workspaceId = "workspace";');
    expect(notation).toContain('sharing = "null";');
    expect(notation).toContain('global.greeting = "hello\\nworld";');
    expect(notation).toContain("start -> choose;");
    expect(notation).toContain("choose -> end [branch=true];");
    expect(notation).toContain('choose -> end [branch="case:other"];');
    expect(notation).toContain("worker -> choose [in=condition];");
    expect(notation).toContain("worker -> worker [in=event];");
    expect(notation).toContain("// start out -> end in has no notation");
  });

  it("writes nested frames and preserves bindings that cannot be expressed as edges", () => {
    const worker = script("worker", {
      missing: { kind: "source", nodeId: "absent" },
    });
    const plan = planOf([
      loopOf("outer", [groupOf("inner", [agent("member")]), worker]),
    ]);
    const notation = writePlanNotation(plan, CATALOG);
    expect(notation).toContain("subgraph cluster_outer {");
    expect(notation).toContain("subgraph cluster_inner {");
    expect(notation).toContain("member [");
    expect(notation).toContain(
      'bind.missing="{\\"kind\\":\\"source\\",\\"nodeId\\":\\"absent\\"}"',
    );
  });
});
