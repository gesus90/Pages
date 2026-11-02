import { describe, expect, it } from "vitest";

import { defaultAgentRunOptions } from "@/definition/AgentConfiguration";
import {
  hasPlanPath,
  planConnectionIssues,
  planExecutionIssues,
} from "@/definition/AgentPlanGraph";
import {
  PLAN_PORT,
  hasPlanBranching,
  planConditionSource,
  planEdgeKind,
  planOrderEdges,
  planRegion,
} from "@/definition/AgentPlanBranching";
import {
  connectPlanBranching,
  disconnectPlanEdge,
  setPlanDecisionCondition,
} from "@/definition/AgentPlanBranchingEdit";
import { planFlowSequence } from "@/definition/AgentPlanSequence";

import { agent, planOf } from "./plan-fixtures";

import type { AgentPlanEdge, AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanStep } from "@/definition/AgentPlan";

function acpAgent(
  id: string,
  overrides: Partial<AgentPlanStep> = {},
): AgentPlanStep {
  return {
    ...agent(id),
    configuration: {
      name: "Agent",
      revision: 1,
      modelProfileId: "model",
      model: "m",
      provider: "claude_code",
      reasoningEffort: null,
      template: {
        markdown: "",
        parameters: [],
        directoryParameter: null,
        run: defaultAgentRunOptions("claude_code"),
      },
    },
    ...overrides,
  };
}

const flow = (from: string, to: string): AgentPlanEdge => ({
  from,
  to,
  fromPort: PLAN_PORT.flowOut,
  toPort: PLAN_PORT.flowIn,
});
const bool = (from: string, to: string): AgentPlanEdge => ({
  from,
  to,
  fromPort: PLAN_PORT.passedOut,
  toPort: PLAN_PORT.conditionIn,
});
const branch = (
  from: string,
  to: string,
  port: "true-out" | "false-out",
): AgentPlanEdge => ({ from, to, fromPort: port, toPort: PLAN_PORT.flowIn });
const event = (from: string, to: string): AgentPlanEdge => ({
  from,
  to,
  fromPort: PLAN_PORT.valueOut,
  toPort: PLAN_PORT.eventIn,
});

const NODES: AgentPlanNode[] = [
  { id: "start", type: "start", x: 0, y: 0 },
  acpAgent("check"),
  { id: "decision", type: "decision", x: 0, y: 0 },
  acpAgent("fix"),
  { id: "end", type: "end", x: 0, y: 0 },
];
const EDGES: AgentPlanEdge[] = [
  flow("start", "check"),
  bool("check", "decision"),
  branch("decision", "end", "true-out"),
  branch("decision", "fix", "false-out"),
  event("fix", "check"),
];

describe("decision edges", () => {
  it("names the kind of an edge by its ports and leaves unknown pairs without meaning", () => {
    expect(EDGES.map((entry) => planEdgeKind(entry))).toEqual([
      "flow",
      "condition",
      "branch",
      "branch",
      "event",
    ]);
    expect(
      planEdgeKind({ fromPort: "value-out", toPort: "flow-in" }),
    ).toBeNull();
  });

  it("lets an event close a cycle without ordering anything", () => {
    expect(planOrderEdges(EDGES)).toHaveLength(4);
    expect(hasPlanPath(EDGES, "fix", "check")).toBe(false);
    expect(hasPlanPath(EDGES, "check", "fix")).toBe(true);
    expect([...planRegion(EDGES, "check")].sort()).toEqual([
      "decision",
      "end",
      "fix",
    ]);
    expect(hasPlanBranching({ nodes: NODES, edges: EDGES })).toBe(true);
    expect(
      hasPlanBranching({
        nodes: NODES.slice(0, 2),
        edges: [flow("start", "check")],
      }),
    ).toBe(false);
    expect(planConditionSource({ edges: EDGES }, "decision")).toBe("check");
  });

  it("numbers the flow without a gap for the cycle", () => {
    const plan = planOf(NODES, EDGES);
    expect(planFlowSequence(plan).gaps).toEqual([]);
    expect(planFlowSequence(plan).order).toEqual([
      "start",
      "check",
      "decision",
      "fix",
      "end",
    ]);
  });
});

const agents = [] as const;

describe("decision validation", () => {
  it("accepts the return path of the fix cycle and finds nothing missing", () => {
    const plan = planOf(NODES, EDGES);
    expect(planConnectionIssues(plan, agents)).toEqual([]);
    expect(
      planExecutionIssues(plan, agents).filter(
        (issue) => issue.reason !== "agent",
      ),
    ).toEqual([]);
  });

  it("refuses an event that does not return to an earlier node", () => {
    const plan = planOf(NODES, [...EDGES.slice(0, 4), event("check", "fix")]);
    expect(planConnectionIssues(plan, agents)).toContainEqual({
      nodeId: "fix",
      port: "event-in",
      reason: "eventOrder",
    });
  });

  it("accepts two cycles one after the other, but refuses a return across the second one", () => {
    const stages: AgentPlanNode[] = [
      { id: "start", type: "start", x: 0, y: 0 },
      acpAgent("check1"),
      { id: "decision1", type: "decision", x: 0, y: 0 },
      acpAgent("fix1"),
      acpAgent("check2"),
      { id: "decision2", type: "decision", x: 0, y: 0 },
      acpAgent("fix2"),
      { id: "end", type: "end", x: 0, y: 0 },
    ];
    const edges: AgentPlanEdge[] = [
      flow("start", "check1"),
      bool("check1", "decision1"),
      branch("decision1", "check2", "true-out"),
      branch("decision1", "fix1", "false-out"),
      event("fix1", "check1"),
      bool("check2", "decision2"),
      branch("decision2", "end", "true-out"),
      branch("decision2", "fix2", "false-out"),
      event("fix2", "check2"),
    ];
    expect(planConnectionIssues(planOf(stages, edges), agents)).toEqual([]);
    // fix2 lies behind check2, which would have to start again without its news.
    expect(
      planConnectionIssues(
        planOf(stages, [...edges, event("fix2", "check1")]),
        agents,
      ),
    ).toContainEqual({
      nodeId: "check1",
      port: "event-in",
      reason: "eventNesting",
    });
  });

  it("refuses a result that returns to two event inputs: the second target would lose the news", () => {
    const nodes: AgentPlanNode[] = [
      { id: "start", type: "start", x: 0, y: 0 },
      acpAgent("first"),
      ...NODES.slice(1),
    ];
    const edges = [
      flow("start", "first"),
      flow("first", "check"),
      ...EDGES.slice(1),
      event("fix", "first"),
    ];
    expect(planConnectionIssues(planOf(nodes, edges), agents)).toContainEqual({
      nodeId: "fix",
      port: "value-out",
      reason: "eventFanout",
    });
  });

  it("refuses a flow cycle but not the event that returns", () => {
    const plan = planOf(NODES, [...EDGES, flow("fix", "check")]);
    expect(planConnectionIssues(plan, agents).map((i) => i.reason)).toContain(
      "cycle",
    );
  });
});

describe("decision completeness and boundaries", () => {
  it("refuses two conditions and wants both outputs and one condition before the start", () => {
    const twice = planOf(NODES, [...EDGES, { ...bool("fix", "decision") }]);
    expect(planConnectionIssues(twice, agents)).toContainEqual({
      nodeId: "decision",
      port: "condition-in",
      reason: "decisionCondition",
    });
    const open = planOf(NODES, [
      flow("start", "check"),
      flow("check", "end"),
      branch("decision", "end", "true-out"),
    ]);
    const reasons = planExecutionIssues(open, agents).map(
      (issue) => `${issue.nodeId}:${issue.port}:${issue.reason}`,
    );
    expect(reasons).toContain("decision:condition-in:decisionCondition");
    expect(reasons).toContain("decision:false-out:decisionBranch");
    expect(reasons).not.toContain("decision:true-out:decisionBranch");
  });

  it("refuses a boolean result, event or decision wire that leaves the shape of the contract", () => {
    const wrong = planOf(NODES, [
      flow("start", "check"),
      { ...bool("check", "end") },
    ]);
    expect(
      planConnectionIssues(wrong, agents).filter(
        (issue) => issue.reason === "port",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("keeps decisions, boolean results and events out of groups and loops", () => {
    const loop = {
      id: "loop",
      type: "loop" as const,
      name: "loop",
      x: 0,
      y: 0,
      steps: [acpAgent("inner")],
      edges: [],
      runs: 1,
      runsSource: "value" as const,
      bindings: {},
      countMode: "max" as const,
      sessionPolicy: "reuse" as const,
      condition: null,
    };
    const plan = planOf([...NODES, loop], [...EDGES, event("fix", "loop")]);
    expect(planConnectionIssues(plan, agents).map((i) => i.reason)).toContain(
      "branchBoundary",
    );
  });

  it("asks an agent with an event input or a boolean result for an ACP runner on the Pages host and no gate", () => {
    const remote = acpAgent("check", {
      executionTarget: { kind: "remote", workspaceId: "w" },
      completionGate: { version: 1, requiredChecks: [] },
    });
    const plan = planOf(
      NODES.map((node) => (node.id === "check" ? remote : node)),
      EDGES,
    );
    const reasons = planConnectionIssues(plan, agents).map(
      (issue) => issue.reason,
    );
    expect(reasons).toContain("branchRemote");
    expect(reasons).toContain("branchGate");
    const plain = planOf(
      NODES.map((node) => (node.id === "check" ? { ...agent("check") } : node)),
      EDGES,
    );
    expect(planConnectionIssues(plain, agents).map((i) => i.reason)).toContain(
      "branchProvider",
    );
  });
});

describe("decision editing", () => {
  it("adds, replaces and removes edges by their ports", () => {
    const plan = planOf(NODES, []);
    const connected = connectPlanBranching(plan, {
      kind: "event",
      from: "fix",
      to: "check",
    });
    expect(connected.edges).toEqual([event("fix", "check")]);
    const first = setPlanDecisionCondition(connected, "decision", "check");
    const replaced = setPlanDecisionCondition(first, "decision", "fix");
    expect(
      replaced.edges.filter((entry) => planEdgeKind(entry) === "condition"),
    ).toEqual([bool("fix", "decision")]);
    expect(setPlanDecisionCondition(replaced, "decision", null).edges).toEqual([
      event("fix", "check"),
    ]);
    expect(disconnectPlanEdge(replaced, event("fix", "check")).edges).toEqual([
      bool("fix", "decision"),
    ]);
  });
});

describe("loops behind an event", () => {
  it("refuses a loop behind the agent an event starts again, but not one in front of it", () => {
    const loop = {
      id: "loop",
      type: "loop" as const,
      name: "loop",
      x: 0,
      y: 0,
      steps: [acpAgent("inner")],
      edges: [],
      runs: 1,
      runsSource: "value" as const,
      bindings: {},
      countMode: "max" as const,
      sessionPolicy: "reuse" as const,
      condition: null,
    };
    const issuesOf = (edges: AgentPlanEdge[]): AgentPlanIssue[] =>
      planConnectionIssues(planOf([...NODES, loop], edges), agents).filter(
        (issue) => issue.nodeId === "loop",
      );
    // A loop behind the fix keeps its finished iterations, so it would not run in the next round.
    expect(issuesOf([...EDGES, flow("fix", "loop")])).toContainEqual({
      nodeId: "loop",
      port: null,
      reason: "branchBoundary",
    });
    // Before the target of the event, it runs once, before the cycle begins.
    expect(
      issuesOf([
        flow("start", "loop"),
        flow("loop", "check"),
        ...EDGES.slice(1),
      ]).filter((issue) => issue.reason === "branchBoundary"),
    ).toEqual([]);
  });
});
