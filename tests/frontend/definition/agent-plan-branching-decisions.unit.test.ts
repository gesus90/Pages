import { describe, expect, it } from "vitest";

import {
  planBranchingExecutionIssues,
  planBranchingIssues,
} from "@/definition/AgentPlanBranchingGraph";
import { PLAN_DECISION_QUESTION_LENGTH } from "@/definition/AgentPlanDecision";

import {
  AGENTS,
  agentNode,
  booleanParameter,
  branch,
  decision,
  event,
  flow,
  modelDecision,
  oneOutput,
  passed,
  reasons,
  taskNode,
} from "./plan-branching-fixtures";
import { boundary, groupOf, loopOf, planOf, script } from "./plan-fixtures";
import { closeout } from "./plan-graph-fixtures";

import type {
  AgentPlanDecision,
  AgentPlanEdge,
  AgentPlanNode,
} from "@/definition/AgentPlan";

function inputIssuesOf(
  node: AgentPlanDecision,
  others: AgentPlanNode[] = [],
  edges: AgentPlanEdge[] = [],
): string[] {
  return reasons(planBranchingIssues(planOf([node, ...others], edges), AGENTS));
}

function execution(
  nodes: AgentPlanNode[],
  edges: AgentPlanEdge[] = [],
): string[] {
  return reasons(planBranchingExecutionIssues(planOf(nodes, edges)));
}

const BOTH = [branch("d", "true-out", "x"), branch("d", "false-out", "y")];
const TARGETS = [boundary("x", "end"), boundary("y", "end")];

describe("the bound data input of a decision", () => {
  it("accepts a bound boolean parameter and a boolean result edge", () => {
    expect(
      inputIssuesOf(decision("d", { input: { kind: "source", nodeId: "p" } }), [
        booleanParameter("p"),
      ]),
    ).toEqual([]);
    expect(
      inputIssuesOf(decision("d"), [agentNode("a")], [passed("a", "d")]),
    ).toEqual([]);
    expect(inputIssuesOf(decision("d"))).toEqual([]);
  });

  it("refuses a parameter that is no boolean or a source that does not exist", () => {
    expect(
      inputIssuesOf(decision("d", { input: { kind: "source", nodeId: "p" } }), [
        booleanParameter("p", "string"),
      ]),
    ).toEqual(["d:condition-in:decisionInput"]);
    expect(
      inputIssuesOf(
        decision("d", { input: { kind: "source", nodeId: "none" } }),
      ),
    ).toEqual(["d:condition-in:decisionInput"]);
    expect(
      inputIssuesOf(decision("d", { input: { kind: "source", nodeId: "a" } }), [
        agentNode("a"),
      ]),
    ).toEqual(["d:condition-in:decisionInput"]);
  });

  it("lets a model decision read a ticket, but no parameter and no boolean edge", () => {
    expect(
      inputIssuesOf(
        modelDecision("d", { input: { kind: "source", nodeId: "t" } }),
        [taskNode("t")],
      ),
    ).toEqual([]);
    expect(
      inputIssuesOf(
        modelDecision("d", { input: { kind: "source", nodeId: "p" } }),
        [booleanParameter("p")],
      ),
    ).toEqual(["d:condition-in:decisionInput"]);
    expect(
      inputIssuesOf(modelDecision("d"), [agentNode("a")], [passed("a", "d")]),
    ).toEqual(["d:condition-in:decisionInput"]);
  });

  it("refuses a decision that has a boolean edge and a bound input, or two edges", () => {
    expect(
      inputIssuesOf(
        decision("d", { input: { kind: "source", nodeId: "p" } }),
        [booleanParameter("p"), agentNode("a")],
        [passed("a", "d")],
      ),
    ).toEqual(["d:condition-in:decisionCondition"]);
    expect(
      inputIssuesOf(
        decision("d"),
        [agentNode("a"), agentNode("b")],
        [passed("a", "d"), passed("b", "d")],
      ),
    ).toEqual(["d:condition-in:decisionCondition"]);
  });
});

describe("the result a model decision reads", () => {
  it("lets only a model decision read a result, and only of a text producing node", () => {
    const read = (stepId: string): AgentPlanDecision =>
      modelDecision("d", { input: { kind: "result", stepId } });
    const wired = (id: string, node: AgentPlanNode): string[] =>
      inputIssuesOf(read(id), [node], [flow(id, "d")]);
    expect(wired("a", agentNode("a"))).toEqual([]);
    expect(wired("s", oneOutput("s"))).toEqual([]);
    expect(wired("c", closeout("c"))).toEqual([]);
    expect(wired("s", script("s"))).toEqual(["d:condition-in:decisionInput"]);
    expect(wired("p", booleanParameter("p"))).toEqual([
      "d:condition-in:decisionInput",
    ]);
    expect(inputIssuesOf(read("missing"), [], [])).toEqual([
      "d:condition-in:decisionInput",
    ]);
    expect(
      inputIssuesOf(
        decision("d", { input: { kind: "result", stepId: "a" } }),
        [agentNode("a")],
        [flow("a", "d")],
      ),
    ).toEqual(["d:condition-in:decisionInput"]);
    expect(
      inputIssuesOf(
        modelDecision("d", {
          input: { kind: "literal", value: null },
        }),
      ),
    ).toEqual(["d:condition-in:decisionInput"]);
  });

  it("asks for the result to be ready before the decision starts", () => {
    expect(
      inputIssuesOf(
        modelDecision("d", { input: { kind: "result", stepId: "a" } }),
        [agentNode("a")],
      ),
    ).toEqual(["d:condition-in:resultOrder"]);
  });

  it("keeps the result of a loop decision inside its loop", () => {
    const read = (stepId: string): AgentPlanDecision =>
      modelDecision("d", { input: { kind: "result", stepId } });
    const loop = loopOf("l", [agentNode("m")], [], { decisions: [read("m")] });
    expect(reasons(planBranchingIssues(planOf([loop]), AGENTS))).toContain(
      "d:condition-in:resultOrder",
    );
    const outside = loopOf("l", [agentNode("m")], [], {
      decisions: [read("a")],
    });
    expect(
      reasons(
        planBranchingIssues(
          planOf([agentNode("a"), outside], [flow("a", "d")]),
          AGENTS,
        ),
      ),
    ).toContain("d:condition-in:loopBoundary");
    const inside = loopOf("l", [agentNode("m")], [flow("m", "d")], {
      decisions: [read("m")],
    });
    expect(
      planBranchingIssues(planOf([inside]), AGENTS).filter(
        (issue) => issue.nodeId === "d",
      ),
    ).toEqual([]);
  });

  it("finds a loop decision through the group of the loop", () => {
    const group = {
      ...groupOf("g", [agentNode("gm")]),
      decisions: [
        modelDecision("d", { input: { kind: "result", stepId: "outside" } }),
      ],
      edges: [flow("gm", "d")],
    };
    const loop = loopOf("l", [group, agentNode("m")]);
    expect(
      reasons(
        planBranchingIssues(planOf([loop, agentNode("outside")]), AGENTS),
      ),
    ).toContain("d:condition-in:loopBoundary");
  });
});

describe("the outputs and the input a decision needs before the plan may start", () => {
  it("accepts a complete boolean decision", () => {
    expect(
      execution(
        [agentNode("a"), decision("d"), ...TARGETS],
        [passed("a", "d"), ...BOTH],
      ),
    ).toEqual([]);
  });

  it("wants a data input for a decision that is about to run", () => {
    expect(execution([decision("d"), ...TARGETS], BOTH)).toEqual([
      "d:condition-in:decisionCondition",
    ]);
  });

  it("wants every output of the decision to lead somewhere", () => {
    expect(
      execution(
        [agentNode("a"), decision("d"), ...TARGETS],
        [passed("a", "d"), branch("d", "true-out", "x")],
      ),
    ).toEqual(["d:false-out:decisionBranch"]);
    expect(
      execution(
        [
          agentNode("a"),
          modelDecision("d", {
            output: "classification",
            cases: [
              { id: "one", name: "One" },
              { id: "two", name: "Two" },
            ],
            input: { kind: "source", nodeId: "t" },
          }),
          taskNode("t"),
          ...TARGETS,
        ],
        [flow("a", "d"), branch("d", "case:one", "x")],
      ),
    ).toEqual(["d:case:two:decisionBranch"]);
  });

  it("refuses an edge that leaves an output the decision does not have", () => {
    expect(
      execution(
        [agentNode("a"), decision("d"), ...TARGETS],
        [passed("a", "d"), ...BOTH, branch("d", "case:old", "x")],
      ),
    ).toEqual(["d:case:old:port"]);
  });

  it("reads the decisions inside groups and loops as the engine does", () => {
    const group = {
      ...groupOf("g", [agentNode("m")]),
      decisions: [decision("gd")],
      edges: [passed("m", "gd")],
    };
    expect(execution([group])).toEqual([
      "gd:true-out:decisionBranch",
      "gd:false-out:decisionBranch",
    ]);
  });
});

describe("the model settings and the sequence input a decision needs before the plan may start", () => {
  it("wants a question of fitting length, an ACP model and a valid value list for a model decision", () => {
    const sequence = [flow("a", "d")];
    const input = { kind: "source", nodeId: "t" } as const;
    const nodes = (node: AgentPlanDecision): AgentPlanNode[] => [
      agentNode("a"),
      taskNode("t"),
      node,
      ...TARGETS,
    ];
    const edges = [...sequence, ...BOTH];
    expect(execution(nodes(modelDecision("d", { input })), edges)).toEqual([]);
    for (const question of [
      undefined,
      "   ",
      "q".repeat(PLAN_DECISION_QUESTION_LENGTH + 1),
    ])
      expect(
        execution(nodes(modelDecision("d", { input, question })), edges),
      ).toEqual(["d:question:decisionQuestion"]);
    expect(
      execution(
        nodes(
          modelDecision("d", {
            input,
            question: "q".repeat(PLAN_DECISION_QUESTION_LENGTH),
          }),
        ),
        edges,
      ),
    ).toEqual([]);
    const model = (
      value: Partial<NonNullable<AgentPlanDecision["model"]>>,
    ): AgentPlanDecision =>
      modelDecision("d", {
        input,
        model: {
          connectionId: "connection",
          provider: "claude_code",
          model: "m",
          reasoningEffort: null,
          ...value,
        },
      });
    for (const broken of [
      model({ connectionId: "" }),
      model({ model: "" }),
      model({ provider: "api" as never }),
      { ...modelDecision("d", { input }), model: undefined },
    ])
      expect(execution(nodes(broken), edges)).toEqual([
        "d:model:decisionModel",
      ]);
    expect(
      execution(
        nodes(
          modelDecision("d", {
            input,
            output: "classification",
            cases: [{ id: "one", name: "One" }],
          }),
        ),
        [...sequence, branch("d", "case:one", "x")],
      ),
    ).toEqual(["d:cases:decisionCases"]);
  });

  it("wants a sequence input when the decision reads a bound input", () => {
    const input = { kind: "source", nodeId: "p" } as const;
    const nodes = [
      booleanParameter("p"),
      agentNode("a"),
      decision("d", { input }),
      ...TARGETS,
    ];
    expect(execution(nodes, BOTH)).toEqual(["d:flow-in:decisionSequence"]);
    expect(execution(nodes, [flow("a", "d"), ...BOTH])).toEqual([]);
    expect(
      execution(nodes, [branch("other", "true-out", "d"), ...BOTH]),
    ).toEqual([]);
    expect(execution(nodes, [event("a", "d"), ...BOTH])).toEqual([
      "d:flow-in:decisionSequence",
    ]);
  });
});

describe("structural findings of drafts", () => {
  it("leaves a half-done model decision alone until the plan starts", () => {
    const draft = modelDecision("d", { question: "", model: undefined });
    expect(planBranchingIssues(planOf([draft]), AGENTS)).toEqual([]);
    expect(reasons(planBranchingExecutionIssues(planOf([draft])))).toContain(
      "d:question:decisionQuestion",
    );
  });
});
