import { describe, expect, it } from "vitest";

import { defaultAgentRunOptions } from "@/definition/AgentConfiguration";
import {
  planLoopBoundRuns,
  planLoopIssues,
  planLoopParameterBoolean,
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
import type { AgentPlanStack } from "@/definition/AgentPlanStack";

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

function stack(id: string, entryCount: number): AgentPlanStack {
  return {
    id,
    type: "stack",
    name: id,
    x: 0,
    y: 0,
    entries: Array.from({ length: entryCount }, (_, index) => ({
      id: `entry-${index}`,
      type: "task" as const,
      taskId: `task-${index}`,
    })),
  };
}

const STACK_COUNT: AgentPlanBinding = {
  kind: "stack",
  stackId: "st",
  output: "count",
};

describe("the iteration count a binding supplies", () => {
  const text = (value: string): AgentPlanParameter =>
    parameter("p", { type: "text", text: value });

  it("reads the number of entries of a stack, an empty stack included", () => {
    expect(planLoopBoundRuns(STACK_COUNT, planOf([stack("st", 3)]))).toBe(3);
    expect(planLoopBoundRuns(STACK_COUNT, planOf([stack("st", 0)]))).toBe(0);
  });

  it("refuses a stack that is missing, too large or read for its entry", () => {
    expect(planLoopBoundRuns(STACK_COUNT, planOf([]))).toBeNull();
    expect(planLoopBoundRuns(STACK_COUNT, planOf([agent("st")]))).toBeNull();
    expect(
      planLoopBoundRuns(STACK_COUNT, planOf([stack("st", 1000)])),
    ).toBeNull();
    expect(
      planLoopBoundRuns(
        { ...STACK_COUNT, output: "content" },
        planOf([stack("st", 2)]),
      ),
    ).toBeNull();
  });

  it("reads the number of a bound parameter node and allows 0", () => {
    const source: AgentPlanBinding = { kind: "source", nodeId: "p" };

    expect(planLoopBoundRuns(source, planOf([text("4")]))).toBe(4);
    expect(planLoopBoundRuns(source, planOf([text("0")]))).toBe(0);
    expect(planLoopBoundRuns(source, planOf([text("four")]))).toBeNull();
    expect(planLoopBoundRuns(source, planOf([]))).toBeNull();
  });

  it("supplies nothing for other bindings or no binding", () => {
    expect(planLoopBoundRuns(undefined, planOf([text("4")]))).toBeNull();
    expect(
      planLoopBoundRuns({ kind: "literal", value: null }, planOf([text("4")])),
    ).toBeNull();
    expect(
      planLoopBoundRuns({ kind: "result", stepId: "p" }, planOf([text("4")])),
    ).toBeNull();
  });
});

describe("the boolean a parameter supplies to a while loop", () => {
  const text = (value: string): AgentPlanParameter =>
    parameter("p", { type: "text", text: value });

  it("reads exactly true and false, trimmed", () => {
    expect(planLoopParameterBoolean(text("true"))).toBe(true);
    expect(planLoopParameterBoolean(text(" false "))).toBe(false);
  });

  it("never reads anything else as false", () => {
    expect(planLoopParameterBoolean(text("yes"))).toBeNull();
    expect(planLoopParameterBoolean(text("TRUE"))).toBeNull();
    expect(planLoopParameterBoolean(text(""))).toBeNull();
    expect(
      planLoopParameterBoolean(parameter("p", { type: "number", number: 1 })),
    ).toBeNull();
    expect(planLoopParameterBoolean(agent("p"))).toBeNull();
    expect(planLoopParameterBoolean(undefined)).toBeNull();
  });
});

describe("validating a count taken from a stack", () => {
  const issue = { nodeId: "loop", port: "runs", reason: "loopRuns" };
  const fromStack = (binding: AgentPlanBinding): AgentPlanLoop =>
    loopOf("loop", [], [], {
      runsSource: "parameter",
      bindings: { runs: binding },
    });

  it("accepts the count output of an existing stack, whatever its size", () => {
    expect(issues([fromStack(STACK_COUNT), stack("st", 0)], true)).toEqual([
      { nodeId: "loop", port: null, reason: "loopSize" },
    ]);
    expect(issues([fromStack(STACK_COUNT), stack("st", 5)])).toEqual([]);
  });

  it("refuses a missing stack, another node and the entry output", () => {
    expect(issues([fromStack(STACK_COUNT)])).toEqual([issue]);
    expect(issues([fromStack(STACK_COUNT), agent("st")])).toEqual([issue]);
    expect(
      issues([
        fromStack({ ...STACK_COUNT, output: "content" }),
        stack("st", 2),
      ]),
    ).toEqual([issue]);
  });
});

describe("validating a while loop", () => {
  const whileFlag = (text: string): AgentPlanParameter =>
    parameter("flag", { type: "text", text });
  const whileLoop = (overrides: Partial<AgentPlanLoop> = {}): AgentPlanLoop =>
    loopOf("loop", [acpAgent("a")], [], {
      mode: "while",
      bindings: { while: { kind: "source", nodeId: "flag" } },
      ...overrides,
    });
  const whileIssue = (port: string): AgentPlanIssue => ({
    nodeId: "loop",
    port,
    reason: "loopWhile",
  });

  it("needs no iteration count and accepts a bound boolean parameter", () => {
    expect(issues([whileLoop({ runs: 0 }), whileFlag("true")])).toEqual([]);
  });

  it("needs a bound parameter node", () => {
    expect(issues([whileLoop({ bindings: {} }), whileFlag("true")])).toEqual([
      whileIssue("while"),
    ]);
    expect(issues([whileLoop()])).toEqual([whileIssue("while")]);
    expect(issues([whileLoop(), acpAgent("flag")])).toEqual([
      whileIssue("while"),
    ]);
  });

  it("checks that the parameter is a boolean only when the plan is about to run", () => {
    expect(issues([whileLoop(), whileFlag("maybe")])).toEqual([]);
    expect(issues([whileLoop(), whileFlag("maybe")], true)).toEqual([
      whileIssue("while"),
    ]);
    expect(issues([whileLoop(), whileFlag("false")], true)).toEqual([]);
  });

  it("needs a member as the source of later checks and a readable path", () => {
    const later = (sourceNodeId: string, outputPath: string): AgentPlanLoop =>
      whileLoop({ while: { sourceNodeId, outputPath } });

    expect(issues([later("a", "$.go"), whileFlag("true")])).toEqual([]);
    expect(issues([later("x", "$.go"), whileFlag("true")])).toEqual([
      whileIssue("source"),
    ]);
    expect(issues([later("a", "go"), whileFlag("true")])).toEqual([
      whileIssue("path"),
    ]);
    expect(issues([later("x", "$.*"), whileFlag("true")])).toEqual([
      whileIssue("source"),
      whileIssue("path"),
    ]);
  });

  it("reads the bound boolean again when no source member is named", () => {
    expect(
      issues([
        whileLoop({ while: { sourceNodeId: "", outputPath: "nope" } }),
        whileFlag("true"),
      ]),
    ).toEqual([]);
    expect(issues([whileLoop({ while: null }), whileFlag("true")])).toEqual([]);
  });
});

describe("validating what a loop may hold", () => {
  it("refuses a loop inside a loop", () => {
    const inner: unknown = loopOf("inner", []);
    const outer = loopOf("loop", [inner as AgentPlanLoop["steps"][number]]);

    expect(issues([outer])).toContainEqual({
      nodeId: "inner",
      port: null,
      reason: "loopNested",
    });
  });

  it("refuses a group of a loop that holds anything but agents", () => {
    const group = (steps: unknown[]): AgentPlanLoop["steps"][number] => ({
      id: "lg",
      type: "group" as const,
      name: "lg",
      x: 0,
      y: 0,
      steps: steps as AgentPlanStep[],
      parameters: [],
      bindings: {},
    });
    const withScript = loopOf("loop", [group([acpAgent("a"), script("s")])]);
    const onlyAgents = loopOf("loop", [group([acpAgent("a")])]);

    expect(issues([withScript])).toContainEqual({
      nodeId: "lg",
      port: null,
      reason: "loopNested",
    });
    expect(issues([onlyAgents])).toEqual([]);
  });
});

describe("validating decisions and stacks around a loop", () => {
  const decision = { id: "d", type: "decision" as const, x: 0, y: 0 };

  it("lets a decision of the loop join its members by internal edges", () => {
    const loop = loopOf("loop", [acpAgent("a")], [flow("a", "d")], {
      decisions: [decision],
    });

    expect(issues([loop])).toEqual([]);
  });

  it("refuses an outer edge into a decision of the loop and ids that repeat", () => {
    const loop = loopOf("loop", [acpAgent("a")], [], {
      decisions: [decision],
    });

    expect(
      issues([loop], false, [{ ...edge("out", "d"), toPort: "flow-in" }]),
    ).toEqual([{ nodeId: "d", port: "flow-in", reason: "loopBoundary" }]);
    expect(issues([loop, agent("d")])).toContainEqual({
      nodeId: "d",
      port: null,
      reason: "duplicateNode",
    });
  });

  it("lets a stack join the members of a loop by flow edges without a boundary issue", () => {
    const loop = loopOf("loop", [acpAgent("a")]);

    expect(
      issues([loop, stack("st", 1)], false, [flow("st", "a"), flow("a", "st")]),
    ).toEqual([]);
  });
});

describe("validating a previous binding of a script", () => {
  const carrying = (isRequired: boolean): AgentPlanLoop =>
    loopOf(
      "loop",
      [
        {
          ...script("s", { carry: { kind: "previous", stepId: "s" } }),
          inputs: [{ name: "carry", type: "text", isRequired }],
        },
      ],
      [],
      { sessionPolicy: "fresh" },
    );

  it("lets an optional input stay empty in the first iteration", () => {
    expect(issues([carrying(false)])).toEqual([]);
  });

  it("needs a start value for a required input, which a script cannot have", () => {
    expect(issues([carrying(true)])).toEqual([
      { nodeId: "s", port: "carry", reason: "loopPrevious" },
    ]);
  });
});
