import { describe, expect, it } from "vitest";

import { isSamePlanValue } from "@/backend/service/mcp/plan/PlanNotationEquality";
import { PlanNotationNames } from "@/backend/service/mcp/plan/PlanNotationNames";
import { previewPlanNotation } from "@/backend/service/mcp/plan/PlanNotationPreview";
import { readPlanNotationDocument } from "@/backend/service/mcp/plan/PlanNotationParser";
import {
  PlanNotationReader,
  readPlanNotationHead,
} from "@/backend/service/mcp/plan/PlanNotationReader";
import { boundary, planOf } from "../../../definition/plan-fixtures";

import type { PlanNotationContext } from "@/backend/service/mcp/plan/PlanNotationContext";
import type { PlanNotationBuild } from "@/backend/service/mcp/plan/PlanNotationReader";
import type { PlanNotationCatalog } from "@/backend/service/mcp/plan/PlanNotationNames";

const CATALOG: PlanNotationCatalog = {
  workspaces: [],
  sources: { agents: [], tasks: [] },
  wikiPages: [],
};

function read(source: string, previous = planOf([])): PlanNotationBuild {
  const context: PlanNotationContext = {
    names: new PlanNotationNames(CATALOG),
    sources: CATALOG.sources,
    previous,
    planTarget: { kind: "local" },
    findings: { issues: [] },
  };
  return new PlanNotationReader(context).read(
    readPlanNotationDocument(source),
    "workspace",
  );
}

describe("plan notation reader", () => {
  it("finds the first workspace attribute and distinguishes identifiers", () => {
    expect(
      readPlanNotationHead(readPlanNotationDocument("digraph {}")),
    ).toEqual({
      workspace: null,
    });
    expect(
      readPlanNotationHead(
        readPlanNotationDocument(
          'digraph { workspaceId="w-1"; workspace=Other; }',
        ),
      ).workspace,
    ).toMatchObject({ value: "w-1", isIdentifier: true });
    expect(
      readPlanNotationHead(
        readPlanNotationDocument("digraph { workspace=Here; }"),
      ).workspace,
    ).toMatchObject({ value: "Here", isIdentifier: false });
  });

  it("reads plan fields, preserves previous node order and connects a flow", () => {
    const result = read(
      'digraph Example { usage=workspace; rankdir=LR; target=local; global.title="Hello"; end [type=end]; start [type=start]; start -> end; }',
      planOf([boundary("start", "start"), boundary("end", "end")]),
    );
    expect(result.plan).toMatchObject({
      name: "Example",
      workspaceId: "workspace",
      usage: "workspace",
      globals: { title: "Hello" },
      executionTarget: { kind: "local" },
      sharing: { isGlobal: false, targets: [], operator: "or" },
    });
    expect(result.rankdir).toBe("LR");
    expect(result.plan.nodes.map((node) => node.id)).toEqual(["start", "end"]);
    expect(result.plan.edges).toEqual([
      { from: "start", to: "end", fromPort: "flow-out", toPort: "flow-in" },
    ]);
    expect(result.issues).toEqual([]);
  });

  it("reports conflicting fields and invalid JSON values", () => {
    const result = read(
      'digraph Named { name=Other; globals="[1]"; global.key=value; sharing="42"; executionTarget="{}"; }',
    );
    expect(result.plan.name).toBe("Named");
    expect(result.plan.globals).toEqual({});
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["duplicate_field", "invalid_value"]),
    );
  });

  it("reports unknown endpoints and refuses links to rejected nodes", () => {
    const result = read(
      "digraph Test { start [type=start]; bad [type=missing]; start -> absent; bad -> start; }",
    );
    expect(result.plan.edges).toEqual([]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown_node", nodeId: "absent" }),
        expect.objectContaining({ code: "invalid_value", nodeId: "bad" }),
      ]),
    );
    expect(
      result.issues.filter((issue) => issue.code === "unknown_node"),
    ).toHaveLength(1);
  });

  it("recognizes JSON null sharing and compares nested plan values canonically", () => {
    const result = read(
      'digraph Test { sharing="null"; globals="{\\"b\\":\\"2\\",\\"a\\":\\"1\\"}"; }',
    );
    expect(result.plan.sharing).toBeUndefined();
    expect(result.plan.globals).toEqual({ a: "1", b: "2" });
    expect(
      isSamePlanValue(
        { b: [{ y: 2, x: 1 }], a: undefined },
        { b: [{ x: 1, y: 2 }] },
      ),
    ).toBe(true);
    expect(isSamePlanValue([1, 2], [2, 1])).toBe(false);
  });
});

describe("plan notation preview", () => {
  it("does not report unchanged nodes or position changes", () => {
    const stored = planOf([boundary("start", "start")]);
    const proposed = planOf([{ ...boundary("start", "start"), x: 100 }]);
    expect(previewPlanNotation(stored, proposed)).toEqual({
      nodes: { added: [], changed: [], removed: [] },
      edges: { added: [], removed: [] },
      fields: [],
    });
  });
});
