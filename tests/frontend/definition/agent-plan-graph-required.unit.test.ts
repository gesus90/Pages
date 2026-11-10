import { describe, expect, it } from "vitest";

import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { agent, planOf } from "./plan-fixtures";
import {
  END,
  START,
  assetNode,
  choice,
  configured,
  execution,
  flow,
  missing,
  of,
  parameterNode,
  parameterOf,
  ticketNode,
  textScript,
  variableNode,
} from "./plan-graph-fixtures";

import type { AgentParameter } from "@/definition/AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

describe("the inputs a node still misses before Play", () => {
  const needed = parameterOf("topic", "text", { isRequired: true });

  it("accepts a configured agent without inputs", () => {
    expect(execution([configured("a")])).toEqual([]);
  });

  it("names a required input without any value", () => {
    expect(missing(configured("a", [needed]))).toEqual([
      { nodeId: "a", port: "topic", reason: "required" },
    ]);
  });

  it("is satisfied by a default, a typed literal or a connected value", () => {
    const filled = (binding: AgentPlanBinding | undefined): AgentPlanStep =>
      configured("a", [needed], {
        bindings: binding ? { topic: binding } : {},
      });

    expect(
      missing(
        configured("a", [
          { ...needed, defaultValue: { type: "text", text: "d" } },
        ]),
      ),
    ).toEqual([]);
    expect(
      missing(filled({ kind: "literal", value: { type: "text", text: "x" } })),
    ).toEqual([]);
    expect(missing(filled({ kind: "literal", value: null }))).toEqual([
      { nodeId: "a", port: "topic", reason: "required" },
    ]);
    expect(
      missing(filled({ kind: "literal", value: { type: "text", text: " " } })),
    ).toEqual([{ nodeId: "a", port: "topic", reason: "required" }]);
    for (const binding of [
      { kind: "result", stepId: "z" },
      { kind: "previous", stepId: "z" },
      { kind: "stack", stackId: "z", output: "count" },
    ] as const)
      expect(
        missing(filled(binding)).filter((issue) => issue.reason === "required"),
      ).toEqual([]);
  });
});

describe("the sources that fill an input before Play", () => {
  const needed = parameterOf("topic", "text", { isRequired: true });

  it("counts a source node only when it really carries a value", () => {
    const from = (nodeId: string): AgentPlanStep =>
      configured("a", [needed], {
        bindings: { topic: { kind: "source", nodeId } },
      });
    const required = [{ nodeId: "a", port: "topic", reason: "required" }];
    const typeIssue = (
      issues: readonly AgentPlanIssue[],
    ): readonly AgentPlanIssue[] =>
      issues.filter((issue) => issue.reason === "required");

    expect(typeIssue(missing(from("t"), [ticketNode("t")]))).toEqual([]);
    expect(typeIssue(missing(from("p"), [parameterNode("p", "x")]))).toEqual(
      [],
    );
    expect(typeIssue(missing(from("p"), [parameterNode("p", " ")]))).toEqual(
      required,
    );
    expect(typeIssue(missing(from("nothing")))).toEqual(required);
    expect(typeIssue(missing(from("f"), [assetNode("f", null)]))).toEqual(
      required,
    );
    expect(typeIssue(missing(from("f"), [assetNode("f")]))).toEqual([]);
    expect(typeIssue(missing(from("v"), [variableNode("v", "g")]))).toEqual(
      required,
    );
  });

  it("reads a variable node from the globals of the plan", () => {
    const step = configured("a", [needed], {
      bindings: { topic: { kind: "source", nodeId: "v" } },
    });
    const plan = (value: string): AgentPlanInput => ({
      ...planOf(
        [START, step, END, variableNode("v", "g")],
        [flow("start", "a"), flow("a", "end")],
      ),
      globals: { g: value },
    });

    expect(planExecutionIssues(plan("set"), [])).toEqual([]);
    expect(of(planExecutionIssues(plan("  "), []), "a")).toEqual([
      { nodeId: "a", port: "topic", reason: "required" },
    ]);
  });

  it("demands the directory input even when it is optional", () => {
    const directory = parameterOf("dir", "workspace");

    expect(
      missing(configured("a", [directory], { directoryParameter: "dir" })),
    ).toEqual([{ nodeId: "a", port: "dir", reason: "required" }]);
    expect(missing(configured("a", [directory]))).toEqual([]);
  });

  it("ignores an optional input nothing fills", () => {
    expect(missing(configured("a", [parameterOf("note", "text")]))).toEqual([]);
  });
});

describe("the agents an input check cannot read before Play", () => {
  const needed = parameterOf("topic", "text", { isRequired: true });

  it("refuses the unsupported run notes in the template or the instruction", () => {
    const notes = { nodeId: "a", port: null, reason: "unsupportedRunNotes" };

    expect(
      missing(configured("a", [], { markdown: "Hello {{@run.notes}}" })),
    ).toEqual([notes]);
    expect(
      missing(
        configured("a", [], {
          overrides: { instruction: "See {{@run.notes}}" },
        }),
      ),
    ).toEqual([notes]);
  });

  it("takes the template of the offered agent when the node has no copy of its own", () => {
    const offered = choice("agent-1", {
      configuration: {
        ...emptyAgentConfiguration(),
        parameters: [needed],
      },
    });

    expect(missing(agent("a"), [], [offered])).toEqual([
      { nodeId: "a", port: "topic", reason: "required" },
    ]);
  });

  it("names an agent that cannot be used or lost its explicit assignment", () => {
    const blocked = choice("agent-1", {
      availability: { isUsable: false, reason: null, personalChoices: [] },
    });
    const agentIssue = { nodeId: "a", port: null, reason: "agent" };

    expect(missing(agent("a"), [], [blocked])).toEqual([agentIssue]);
    expect(
      missing({ ...agent("a"), personalAgentId: "" }, [], [choice("agent-1")]),
    ).toEqual([agentIssue]);
    expect(
      missing(configured("a", [], { overrides: { personalAgentId: "" } })),
    ).toEqual([agentIssue]);
  });
});

describe("the text inputs the template names but nothing fills", () => {
  const result = parameterOf("result", "text");

  function placeholder(
    bindings: Record<string, AgentPlanBinding> = {},
    parameters: AgentParameter[] = [result],
  ): AgentPlanStep {
    return configured("c", parameters, {
      bindings,
      markdown: "Summarise {{result}}",
    });
  }

  function issuesOf(
    step: AgentPlanStep,
    before: AgentPlanNode[] = [],
    sources: AgentPlanNode[] = [],
  ): readonly AgentPlanIssue[] {
    const chain = [START, ...before, step, END];
    const edges = chain
      .slice(1)
      .map((node, index) => flow(chain[index].id, node.id));
    return of(
      planExecutionIssues(planOf([...chain, ...sources], edges), []),
      "c",
    );
  }

  it("names a missing result when no agent comes before", () => {
    expect(issuesOf(placeholder())).toEqual([
      { nodeId: "c", port: "result", reason: "resultMissing" },
    ]);
  });

  it("names a missing result also for a single agent before, which is never taken by itself", () => {
    expect(issuesOf(placeholder(), [configured("one")])).toEqual([
      { nodeId: "c", port: "result", reason: "resultMissing" },
    ]);
  });

  it("names an ambiguous result when several agents come before", () => {
    expect(
      issuesOf(placeholder(), [configured("one"), configured("two")]),
    ).toEqual([{ nodeId: "c", port: "result", reason: "resultAmbiguous" }]);
  });

  it("names a literal binding without a usable value", () => {
    expect(
      issuesOf(placeholder({ result: { kind: "literal", value: null } })),
    ).toEqual([{ nodeId: "c", port: "result", reason: "resultMissing" }]);
  });

  it("is satisfied by a typed value, a connection or a default", () => {
    expect(
      issuesOf(
        placeholder({
          result: { kind: "literal", value: { type: "text", text: "x" } },
        }),
      ),
    ).toEqual([]);
    expect(
      issuesOf(
        placeholder({ result: { kind: "source", nodeId: "p" } }),
        [],
        [parameterNode("p", "x")],
      ),
    ).toEqual([]);
    expect(
      issuesOf(
        placeholder({}, [
          parameterOf("result", "text", {
            defaultValue: { type: "text", text: "d" },
          }),
        ]),
      ),
    ).toEqual([]);
  });

  it("does not ask for an input the template does not name or that is no text", () => {
    expect(
      issuesOf(configured("c", [result], { markdown: "Nothing to fill here" })),
    ).toEqual([]);
    expect(
      issuesOf(
        configured("c", [parameterOf("result", "number")], {
          markdown: "Summarise {{result}}",
        }),
      ),
    ).toEqual([]);
  });
});

describe("the declared inputs of a script before Play", () => {
  const inputs: AgentPlanScript["inputs"] = [
    { name: "need", type: "text", isRequired: true },
    { name: "want", type: "text", isRequired: false },
  ];

  function scriptIssues(
    bindings: Record<string, AgentPlanBinding>,
    overrides: Partial<AgentPlanScript> = {},
    extra: AgentPlanNode[] = [],
  ): readonly AgentPlanIssue[] {
    return of(
      execution(
        [{ ...textScript("s", inputs, bindings), ...overrides }],
        [],
        extra,
      ),
      "s",
    );
  }

  it("names a required input without a value and skips the optional one", () => {
    expect(scriptIssues({})).toEqual([
      { nodeId: "s", port: "need", reason: "required" },
    ]);
  });

  it("is satisfied by a typed literal or a connected value", () => {
    expect(
      scriptIssues({
        need: { kind: "literal", value: { type: "text", text: "x" } },
      }),
    ).toEqual([]);
    expect(
      scriptIssues({ need: { kind: "source", nodeId: "p" } }, {}, [
        parameterNode("p", "x"),
      ]),
    ).toEqual([]);
    expect(scriptIssues({ need: { kind: "literal", value: null } })).toEqual([
      { nodeId: "s", port: "need", reason: "required" },
    ]);
  });

  it("names an invalid configuration of the script itself", () => {
    expect(
      scriptIssues(
        { need: { kind: "literal", value: { type: "text", text: "x" } } },
        { content: "   " },
      ),
    ).toEqual([{ nodeId: "s", port: null, reason: "scriptConfiguration" }]);
  });
});
