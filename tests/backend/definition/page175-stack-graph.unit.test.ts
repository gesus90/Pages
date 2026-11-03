import { describe, expect, it } from "vitest";

import { readPlanNode } from "@/backend/agents/AgentPlanInput";
import {
  planConnectionIssues,
  planExecutionIssues,
  removePlanNode,
} from "@/definition/AgentPlanGraph";
import {
  expandPlanLoops,
  planLoopScopeEntries,
} from "@/definition/AgentPlanLoop";
import {
  planLoopBoundRuns,
  planLoopParameterBoolean,
} from "@/definition/AgentPlanLoopGraph";
import {
  currentPlanStackEntry,
  isPlanOuterRunStep,
  planStackScope,
  planStackState,
  triggerPlanStack,
} from "@/definition/AgentPlanStack";

import {
  agent,
  boundary,
  edge,
  groupOf,
  loopOf,
  planOf,
} from "./plan-fixtures";

import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type {
  AgentPlanBinding,
  AgentPlanParameter,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";

const FLOW = { fromPort: "flow-out", toPort: "flow-in" };

function flow(from: string, to: string): ReturnType<typeof edge> {
  return { ...edge(from, to), ...FLOW };
}

function stack(
  entries: AgentPlanStack["entries"] = [
    { id: "e1", type: "task", taskId: "t1" },
    { id: "e2", type: "task", taskId: "t2" },
    { id: "e3", type: "task", taskId: "t3" },
  ],
): AgentPlanStack {
  return { id: "stack", type: "stack", name: "Stapel", x: 0, y: 0, entries };
}

/** An agent with a pinned template: a ticket input, a text input and a number input. */
function worker(
  id: string,
  bindings: Record<string, AgentPlanBinding> = {},
): AgentPlanStep {
  return {
    ...agent(id, bindings),
    configuration: {
      name: "Agent",
      revision: 1,
      modelProfileId: "model",
      model: "m",
      provider: "codex_cli",
      reasoningEffort: null,
      template: {
        markdown: "",
        parameters: [
          {
            name: "aufgabe",
            type: "ticket",
            description: "",
            isRequired: false,
            defaultValue: null,
          },
          {
            name: "text",
            type: "text",
            description: "",
            isRequired: false,
            defaultValue: null,
          },
          {
            name: "zahl",
            type: "number",
            description: "",
            isRequired: false,
            defaultValue: null,
          },
        ],
        directoryParameter: null,
      },
    },
  };
}

const CONTENT: AgentPlanBinding = {
  kind: "stack",
  stackId: "stack",
  output: "content",
};
const COUNT: AgentPlanBinding = {
  kind: "stack",
  stackId: "stack",
  output: "count",
};

function reasons(issues: readonly AgentPlanIssue[]): readonly string[] {
  return issues.map((issue) => `${issue.nodeId}:${issue.reason}`);
}

describe("stack state", () => {
  it("hands over the entries in order and then nothing, without starting over", () => {
    const node = stack();
    const origin = { loopId: null, iteration: null, at: "t" };
    let record = undefined as
      ReturnType<typeof triggerPlanStack>["record"] | undefined;
    const handed: (string | null)[] = [];
    for (let index = 0; index < 5; index += 1) {
      const triggered = triggerPlanStack(record, node, origin);
      record = triggered.record;
      handed.push(triggered.handover.entryId);
    }
    expect(handed).toEqual(["e1", "e2", "e3", null, null]);
    expect(record).toMatchObject({ emptyTriggers: 2, last: "empty" });
    // After a trigger that found nothing, no earlier entry is the content any more.
    expect(currentPlanStackEntry(node, record)).toBeNull();
    expect(planStackState(node, record)).toBe("used");
    expect(planStackState(stack([]), undefined)).toBe("empty");
  });
});

describe("stack scope", () => {
  it("is a step of a loop when its flow edges join loop members, without being moved into the loop", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        boundary("end", "end"),
        stack(),
        loopOf("loop", [worker("work", { aufgabe: CONTENT })]),
      ],
      [flow("start", "loop"), flow("stack", "work"), flow("loop", "end")],
    );
    expect(planStackScope(plan, "stack")).toEqual({
      kind: "loop",
      loopId: "loop",
    });
    expect(plan.nodes.some((node) => node.id === "stack")).toBe(true);
    expect(isPlanOuterRunStep(plan, { id: "stack", type: "stack" })).toBe(
      false,
    );
    const [loop] = plan.nodes.filter((node) => node.type === "loop");
    if (loop?.type !== "loop") throw new Error("No loop");
    // Nothing in the loop triggers it, so each iteration starts with it.
    expect(planLoopScopeEntries(plan, loop)).toEqual(["stack"]);
    expect(expandPlanLoops(plan).edges).toContainEqual(
      expect.objectContaining({ from: "start", to: "stack" }),
    );
    expect(reasons(planExecutionIssues(plan, []))).not.toContain(
      "stack:flowIn",
    );
  });

  it("refuses a stack triggered both in a loop and outside it", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        boundary("end", "end"),
        stack(),
        worker("outer"),
        loopOf("loop", [worker("work")]),
      ],
      [
        flow("start", "stack"),
        flow("stack", "outer"),
        flow("stack", "work"),
        flow("outer", "loop"),
        flow("loop", "end"),
      ],
    );
    expect(planStackScope(plan, "stack").kind).toBe("mixed");
    expect(reasons(planConnectionIssues(plan, []))).toContain(
      "stack:stackScope",
    );
  });
});

describe("stack bindings", () => {
  it("keeps the count and the content apart and checks their types", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        boundary("end", "end"),
        stack(),
        worker("work", { aufgabe: CONTENT, text: COUNT, zahl: COUNT }),
      ],
      [flow("start", "stack"), flow("stack", "work"), flow("work", "end")],
    );
    expect(reasons(planConnectionIssues(plan, []))).toEqual([]);
    const wrong = planOf(
      plan.nodes.map((node) =>
        node.id === "work" ? worker("work", { zahl: CONTENT }) : node,
      ),
      [...plan.edges],
    );
    expect(reasons(planConnectionIssues(wrong, []))).toContain("work:type");
  });

  it("refuses to read the content of a stack that is not before the reader", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        boundary("end", "end"),
        stack(),
        worker("work", { aufgabe: CONTENT }),
        worker("other"),
      ],
      [
        flow("start", "work"),
        flow("work", "stack"),
        flow("stack", "other"),
        flow("other", "end"),
      ],
    );
    expect(reasons(planConnectionIssues(plan, []))).toContain(
      "work:stackOrder",
    );
  });

  it("lets an untriggered stack be read for its count only", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        boundary("end", "end"),
        stack(),
        worker("work", { zahl: COUNT }),
      ],
      [flow("start", "work"), flow("work", "end")],
    );
    expect(reasons(planExecutionIssues(plan, []))).toEqual(
      expect.not.arrayContaining(["stack:flowIn", "stack:flowOut"]),
    );
    expect(isPlanOuterRunStep(plan, { id: "stack", type: "stack" })).toBe(
      false,
    );
  });

  it("drops the bindings of a removed stack", () => {
    const plan = planOf(
      [stack(), worker("work", { aufgabe: CONTENT, zahl: COUNT })],
      [],
    );
    const removed = removePlanNode(plan, "stack");
    const work = removed.nodes.find((node) => node.id === "work");
    expect(work?.type === "agent" ? work.bindings : null).toEqual({});
  });
});

describe("loop count and while", () => {
  it("binds the total count of a stack, 0 included", () => {
    expect(planLoopBoundRuns(COUNT, planOf([stack()]))).toBe(3);
    expect(planLoopBoundRuns(COUNT, planOf([stack([])]))).toBe(0);
    const zero: AgentPlanParameter = {
      id: "p",
      type: "parameter",
      name: "p",
      format: "string",
      value: { type: "text", text: "0" },
      x: 0,
      y: 0,
    };
    expect(
      planLoopBoundRuns({ kind: "source", nodeId: "p" }, planOf([zero])),
    ).toBe(0);
  });

  it("reads only true or false as the boolean of a while loop", () => {
    const booleanParameter = (text: string): AgentPlanParameter => ({
      id: "f",
      type: "parameter",
      name: "f",
      format: "json",
      value: { type: "text", text },
      x: 0,
      y: 0,
    });
    expect(planLoopParameterBoolean(booleanParameter("true"))).toBe(true);
    expect(planLoopParameterBoolean(booleanParameter("false"))).toBe(false);
    expect(planLoopParameterBoolean(booleanParameter('"false"'))).toBeNull();
    expect(planLoopParameterBoolean(booleanParameter("0"))).toBeNull();
  });

  it("refuses a while loop without a bound boolean and a later check without a member", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        boundary("end", "end"),
        loopOf("loop", [worker("work")], [], {
          mode: "while",
          while: { sourceNodeId: "missing", outputPath: "$.weiter" },
        }),
      ],
      [flow("start", "loop"), flow("loop", "end")],
    );
    expect(
      planConnectionIssues(plan, []).filter(
        (issue) => issue.reason === "loopWhile",
      ),
    ).toEqual([
      { nodeId: "loop", port: "while", reason: "loopWhile" },
      { nodeId: "loop", port: "source", reason: "loopWhile" },
    ]);
  });

  it("accepts agents, scripts and groups as loop content and refuses a loop in a loop", () => {
    const plan = planOf(
      [
        boundary("start", "start"),
        boundary("end", "end"),
        loopOf("loop", [groupOf("group", [worker("a"), worker("b")])], [], {
          sessionPolicy: "fresh",
        }),
      ],
      [flow("start", "loop"), flow("loop", "end")],
    );
    expect(
      reasons(planExecutionIssues(plan, [])).filter((reason) =>
        /loopNested|groupBoundary|duplicateNode/u.test(reason),
      ),
    ).toEqual([]);
    expect(() =>
      readPlanNode({
        ...loopOf("outer", []),
        steps: [loopOf("inner", [])],
      }),
    ).toThrow();
  });
});

describe("stack parsing", () => {
  it("reads a stack with ticket and value entries and refuses a repeated entry", () => {
    const parsed = readPlanNode({
      id: "stack",
      type: "stack",
      name: "Stapel",
      x: 0,
      y: 0,
      entries: [
        { id: "e1", type: "task", taskId: "t1" },
        {
          id: "e2",
          type: "parameter",
          name: "wert",
          format: "string",
          value: { type: "text", text: "Hallo" },
        },
      ],
    });
    expect(parsed).toMatchObject({ type: "stack", entries: [{}, {}] });
    expect(() =>
      readPlanNode({
        id: "stack",
        type: "stack",
        name: "Stapel",
        x: 0,
        y: 0,
        entries: [
          { id: "e1", type: "task", taskId: "t1" },
          { id: "e1", type: "task", taskId: "t2" },
        ],
      }),
    ).toThrow();
  });
});
