import { describe, expect, it } from "vitest";

import { PlanNotationNames } from "@/backend/service/mcp/plan/PlanNotationNames";
import {
  PlanNotationNodeReader,
  planNotationDeclarations,
} from "@/backend/service/mcp/plan/PlanNotationNodes";
import { readPlanNotationDocument } from "@/backend/service/mcp/plan/PlanNotationParser";

import type {
  PlanNotationDeclaration,
  PlanNotationNodeRecords,
} from "@/backend/service/mcp/plan/PlanNotationNodes";
import type { PlanNotationIssue } from "@/backend/service/mcp/plan/PlanNotationIssue";
import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { PlanNotationContext } from "@/backend/service/mcp/plan/PlanNotationContext";

function readNodes(source: string): {
  nodes: AgentPlanNode[];
  records: PlanNotationNodeRecords;
  issues: PlanNotationIssue[];
  declarations: readonly PlanNotationDeclaration[];
} {
  const sources: PlanNotationContext["sources"] = { agents: [], tasks: [] };
  const context: PlanNotationContext = {
    names: new PlanNotationNames({ workspaces: [], sources, wikiPages: [] }),
    sources,
    previous: null,
    planTarget: { kind: "local" },
    findings: { issues: [] },
  };
  const document = readPlanNotationDocument(source);
  const declarations = planNotationDeclarations(document.statements);
  const reader = new PlanNotationNodeReader(context);
  const nodes = reader.read(declarations);
  return {
    nodes,
    records: reader.records,
    issues: context.findings.issues,
    declarations,
  };
}

describe("plan notation node declarations", () => {
  it("collects nodes and frame assignments while ignoring edges and graph assignments", () => {
    const result = readNodes(
      "digraph { title=Example; a [type=start]; a -> b; subgraph cluster_g { type=group; b [type=decision]; } }",
    );
    expect(result.declarations.map((entry) => entry.id)).toEqual(["a", "g"]);
    expect(
      result.declarations[1]?.attributes.map((entry) => entry.key),
    ).toEqual(["type"]);
    expect(result.nodes.map((node) => node.id)).toEqual(["a", "g"]);
    expect(result.nodes[1]).toMatchObject({
      type: "group",
      decisions: [{ id: "b", type: "decision" }],
    });
    expect(result.issues).toEqual([]);
  });

  it("records rejected and duplicate nodes and rejects frame types outside frames", () => {
    const result = readNodes(
      "digraph { a [type=start]; a [type=end]; missing; bad [type=group]; invalid [type=unknown]; }",
    );
    expect(result.nodes.map((node) => node.id)).toEqual(["a"]);
    expect([...result.records.rejected]).toEqual(["missing", "bad", "invalid"]);
    expect(result.issues.map((issue) => [issue.nodeId, issue.code])).toEqual([
      ["a", "duplicate_node"],
      ["missing", "invalid_value"],
      ["bad", "invalid_value"],
      ["invalid", "invalid_value"],
    ]);
  });

  it("records explicit loop settings and its nested decisions", () => {
    const result = readNodes(
      "digraph { subgraph cluster_repeat { type=loop; mode=count; runsSource=value; choose [type=decision]; } }",
    );
    expect(result.nodes[0]).toMatchObject({
      id: "repeat",
      type: "loop",
      decisions: [{ id: "choose", type: "decision" }],
    });
    expect(result.records.loops.get("repeat")).toEqual({
      mode: "count",
      runsSource: "value",
    });
    expect(result.issues).toEqual([]);
  });

  it("reports invalid nodes without reporting their bindings as unknown attributes", () => {
    const result = readNodes(
      'digraph { bad [type=task, in.missing=x, bind.other="{}"]; }',
    );
    expect(result.nodes).toEqual([]);
    expect(result.records.rejected.has("bad")).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "invalid_value",
      "plan_invalid",
    ]);
  });

  it("reports unknown literal ports and invalid JSON bindings on valid scripts", () => {
    const result = readNodes(
      'digraph { job [type=script, interpreterProfileId=shell, content=run, in.missing=x, bind.foo="{}"]; }',
    );
    expect(result.nodes).toHaveLength(1);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "unknown_port",
      "invalid_value",
    ]);
  });
});
