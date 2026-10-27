import { describe, expect, it } from "vitest";

import { defaultAgentRunOptions } from "@/definition/AgentConfiguration";
import {
  planLoopIssues,
  planLoopParameterRuns,
} from "@/definition/AgentPlanLoopGraph";

import { agent, edge, loopOf, planOf, script } from "./plan-fixtures";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type {
  AgentPlanBinding,
  AgentPlanNode,
  AgentPlanParameter,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

const FLOW = { fromPort: "flow-out", toPort: "flow-in" };

function flow(from: string, to: string): ReturnType<typeof edge> {
  return { ...edge(from, to), ...FLOW };
}

function parameter(
  id: string,
  value: AgentPlanParameter["value"],
): AgentPlanParameter {
  return {
    id,
    type: "parameter",
    name: id,
    format: "string",
    value,
    x: 0,
    y: 0,
  };
}

/** An ACP agent node with one declared text input that has a start value. */
function acpAgent(
  id: string,
  bindings: Record<string, AgentPlanBinding> = {},
  hasStartValue = true,
): AgentPlanStep {
  return {
    ...agent(id, bindings),
    configuration: {
      name: "Agent",
      revision: 1,
      modelProfileId: "model",
      model: "m",
      provider: "claude_code",
      reasoningEffort: null,
      template: {
        markdown: "",
        parameters: [
          {
            name: "carry",
            type: "text",
            description: "",
            isRequired: false,
            defaultValue: hasStartValue
              ? { type: "text", text: "start" }
              : null,
          },
        ],
        directoryParameter: null,
        run: defaultAgentRunOptions("claude_code"),
      },
    },
  };
}

const AGENTS: readonly AgentDefinitionChoice[] = [];

function issues(
  nodes: AgentPlanNode[],
  isExecution = false,
  edges: ReturnType<typeof edge>[] = [],
): readonly AgentPlanIssue[] {
  return planLoopIssues(planOf(nodes, edges), AGENTS, isExecution);
}

describe("the iteration count a parameter supplies", () => {
  it("reads a whole number or the digits of a text from a parameter node", () => {
    expect(
      planLoopParameterRuns(parameter("p", { type: "number", number: 7 })),
    ).toBe(7);
    expect(
      planLoopParameterRuns(parameter("p", { type: "text", text: " 12 " })),
    ).toBe(12);
  });

  it("refuses everything else", () => {
    expect(
      planLoopParameterRuns(parameter("p", { type: "number", number: 1000 })),
    ).toBeNull();
    expect(
      planLoopParameterRuns(parameter("p", { type: "number", number: 1.5 })),
    ).toBeNull();
    expect(
      planLoopParameterRuns(parameter("p", { type: "text", text: "many" })),
    ).toBeNull();
    expect(
      planLoopParameterRuns(parameter("p", { type: "ticket", ticketId: "t" })),
    ).toBeNull();
    expect(planLoopParameterRuns(agent("a"))).toBeNull();
    expect(planLoopParameterRuns(undefined)).toBeNull();
  });
});

describe("validating the shell of a loop", () => {
  it("accepts a well-formed loop", () => {
    expect(
      issues([loopOf("loop", [acpAgent("a"), script("s")], [flow("a", "s")])]),
    ).toEqual([]);
  });

  it("refuses an empty loop only when the plan is about to run", () => {
    const empty = loopOf("loop", []);

    expect(issues([empty])).toEqual([]);
    expect(issues([empty], true)).toEqual([
      { nodeId: "loop", port: null, reason: "loopSize" },
    ]);
  });

  it.each([
    { label: "blank", name: "   " },
    { label: "too long", name: "x".repeat(121) },
    { label: "holding a control character", name: "bad\u0007name" },
  ])("refuses a loop name that is $label", ({ name }) => {
    expect(issues([loopOf("loop", [], [], { name })])).toEqual([
      { nodeId: "loop", port: null, reason: "name" },
    ]);
  });

  it("refuses a member whose id is already taken, in the outer graph or in a group", () => {
    const duplicate = issues([agent("a"), loopOf("loop", [agent("a")])]);
    const group = issues([
      {
        id: "g",
        type: "group",
        name: "g",
        x: 0,
        y: 0,
        steps: [agent("a")],
        parameters: [],
        bindings: {},
      },
      loopOf("loop", [agent("a")]),
    ]);

    expect(duplicate).toContainEqual({
      nodeId: "a",
      port: null,
      reason: "duplicateNode",
    });
    expect(group).toContainEqual({
      nodeId: "a",
      port: null,
      reason: "duplicateNode",
    });
  });
});

describe("validating the iteration count", () => {
  const issue = { nodeId: "loop", port: "runs", reason: "loopRuns" };

  it("checks a saved count", () => {
    expect(issues([loopOf("loop", [], [], { runs: 3 })])).toEqual([]);
    expect(issues([loopOf("loop", [], [], { runs: 0 })])).toEqual([issue]);
  });

  it("needs a bound parameter node when the count comes from a parameter", () => {
    const fromParameter = (
      bindings: AgentPlanLoop["bindings"],
    ): AgentPlanLoop =>
      loopOf("loop", [], [], { runsSource: "parameter", bindings });
    const bound = fromParameter({ runs: { kind: "source", nodeId: "p" } });

    expect(
      issues([bound, parameter("p", { type: "text", text: "many" })]),
    ).toEqual([]);
    expect(issues([fromParameter({})])).toEqual([issue]);
    expect(
      issues([fromParameter({ runs: { kind: "literal", value: null } })]),
    ).toEqual([issue]);
    expect(issues([bound])).toEqual([issue]);
    expect(issues([bound, agent("p")])).toEqual([issue]);
  });

  it("checks the value of the parameter only when the plan is about to run", () => {
    const bound = loopOf("loop", [], [], {
      runsSource: "parameter",
      bindings: { runs: { kind: "source", nodeId: "p" } },
    });

    expect(
      issues([bound, parameter("p", { type: "text", text: "many" })], true),
    ).toContainEqual(issue);
    expect(
      issues([bound, parameter("p", { type: "number", number: 5 })], true),
    ).toEqual([{ nodeId: "loop", port: null, reason: "loopSize" }]);
  });
});

describe("validating the end condition and the sessions", () => {
  const condition = {
    isEnabled: true,
    sourceNodeId: "a",
    outputPath: "$.done",
    operator: "equals" as const,
    expected: { type: "boolean" as const, value: true },
  };

  it("needs a member as source and a readable path while the condition counts", () => {
    expect(
      issues([loopOf("loop", [acpAgent("a")], [], { condition })]),
    ).toEqual([]);
    expect(
      issues([
        loopOf("loop", [acpAgent("a")], [], {
          condition: { ...condition, sourceNodeId: "x" },
        }),
      ]),
    ).toEqual([{ nodeId: "loop", port: "source", reason: "loopCondition" }]);
    expect(
      issues([
        loopOf("loop", [acpAgent("a")], [], {
          condition: { ...condition, outputPath: "$.*" },
        }),
      ]),
    ).toEqual([{ nodeId: "loop", port: "path", reason: "loopCondition" }]);
  });

  it("ignores a condition that is off or that the loop does not evaluate", () => {
    const broken = { ...condition, sourceNodeId: "x", outputPath: "nope" };

    expect(
      issues([
        loopOf("loop", [acpAgent("a")], [], {
          condition: { ...broken, isEnabled: false },
        }),
      ]),
    ).toEqual([]);
    expect(
      issues([
        loopOf("loop", [acpAgent("a")], [], {
          condition: broken,
          countMode: "expected",
        }),
      ]),
    ).toEqual([]);
  });

  it("reuses sessions only for agents that run over ACP", () => {
    const reuse = loopOf("loop", [
      agent("plain"),
      acpAgent("acp"),
      script("s"),
    ]);

    expect(issues([reuse])).toEqual([
      { nodeId: "plain", port: "provider/adapter", reason: "loopProvider" },
    ]);
    expect(issues([{ ...reuse, sessionPolicy: "fresh" }])).toEqual([]);
  });
});

describe("validating bindings across the border of a loop", () => {
  const previous = (stepId: string): AgentPlanBinding => ({
    kind: "previous",
    stepId,
  });
  const result = (stepId: string): AgentPlanBinding => ({
    kind: "result",
    stepId,
  });

  it("lets a member read the previous iteration of a member when it has a start value", () => {
    const member = acpAgent("a", { carry: previous("a") });

    expect(issues([loopOf("loop", [member])])).toEqual([]);
  });

  it("refuses a previous binding without a start value or to a stranger", () => {
    const noStart = acpAgent("a", { carry: previous("a") }, false);
    const stranger = acpAgent("b", { carry: previous("other") });

    expect(issues([loopOf("loop", [noStart])])).toEqual([
      { nodeId: "a", port: "carry", reason: "loopPrevious" },
    ]);
    expect(issues([loopOf("loop", [stranger])])).toEqual([
      { nodeId: "b", port: "carry", reason: "loopPrevious" },
    ]);
  });

  it("refuses a previous binding outside every loop, also inside a group", () => {
    const outer = acpAgent("o", { carry: previous("a") });
    const grouped = acpAgent("g", { carry: previous("a") });
    const found = issues([
      outer,
      {
        id: "grp",
        type: "group",
        name: "g",
        x: 0,
        y: 0,
        steps: [grouped],
        parameters: [],
        bindings: {},
      },
      script("s", { x: previous("a") }),
    ]);

    expect(
      found
        .filter((entry) => entry.reason === "loopPrevious")
        .map((entry) => entry.nodeId),
    ).toEqual(["o", "g", "s"]);
  });

  it("refuses a member that reads a result from outside the loop", () => {
    const member = acpAgent("a", { carry: result("outside") });

    expect(issues([loopOf("loop", [member]), agent("outside")])).toContainEqual(
      {
        nodeId: "a",
        port: "carry",
        reason: "loopBoundary",
      },
    );
  });

  it("refuses outer edges and outer bindings that reach into the loop", () => {
    const found = issues(
      [
        loopOf("loop", [acpAgent("a")]),
        agent("out", { x: result("a") }),
        agent("other", { y: previous("a") }),
        agent("harmless", {
          fixed: { kind: "literal", value: null },
          shared: { kind: "source", nodeId: "p" },
        }),
        parameter("p", { type: "text", text: "1" }),
      ],
      false,
      [
        { ...edge("out", "a"), toPort: "flow-in" },
        { ...edge("a", "other"), fromPort: "flow-out" },
      ],
    );

    expect(found.filter((entry) => entry.reason === "loopBoundary")).toEqual([
      { nodeId: "a", port: "flow-in", reason: "loopBoundary" },
      { nodeId: "a", port: "flow-out", reason: "loopBoundary" },
      { nodeId: "out", port: "x", reason: "loopBoundary" },
      { nodeId: "other", port: "y", reason: "loopBoundary" },
    ]);
  });

  it("checks the flow edges inside a loop like those of a group", () => {
    const cyclic = loopOf(
      "loop",
      [agent("a"), agent("b")],
      [flow("a", "b"), flow("b", "a")],
    );

    expect(issues([cyclic]).some((entry) => entry.reason === "cycle")).toBe(
      true,
    );
  });
});
