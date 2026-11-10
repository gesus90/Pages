import { describe, expect, it } from "vitest";

import {
  PLAN_DECISION_CASES,
  PLAN_DECISION_CASE_NAME_LENGTH,
  PLAN_DECISION_REASON_LENGTH,
  allPlanDecisions,
  planBooleanParameterValue,
  planDecisionBinding,
  planDecisionCaseId,
  planDecisionCasePort,
  planDecisionCasesProblem,
  planDecisionMode,
  planDecisionOutput,
  planDecisionOutputPorts,
  readPlanDecisionAnswer,
} from "@/definition/AgentPlanDecision";

import { agent, groupOf, loopOf, planOf } from "./plan-fixtures";

import type {
  AgentPlanDecision,
  AgentPlanParameter,
} from "@/definition/AgentPlan";
import type { AgentPlanDecisionCase } from "@/definition/AgentPlanDecision";

const SHIP: AgentPlanDecisionCase = { id: "c1", name: "Ship" };
const REWORK: AgentPlanDecisionCase = { id: "c2", name: "Rework" };
const CASES: readonly AgentPlanDecisionCase[] = [SHIP, REWORK];

const CLASSIFYING = {
  mode: "model",
  output: "classification",
  cases: CASES,
} as const;

function decision(
  id: string,
  extra: Partial<AgentPlanDecision> = {},
): AgentPlanDecision {
  return { id, type: "decision", x: 0, y: 0, ...extra };
}

function parameter(
  format: AgentPlanParameter["format"],
  text: string,
): AgentPlanParameter {
  return {
    id: "p",
    type: "parameter",
    name: "flag",
    format,
    value: { type: "text", text },
    x: 0,
    y: 0,
  };
}

describe("decision mode and output", () => {
  it("reads a decision without a mode as boolean", () => {
    expect(planDecisionMode({})).toBe("boolean");
    expect(planDecisionMode({ mode: "model" })).toBe("model");
  });

  it("classifies only a model decision that asks for a classification", () => {
    expect(planDecisionOutput({})).toBe("boolean");
    expect(planDecisionOutput({ output: "classification" })).toBe("boolean");
    expect(planDecisionOutput({ mode: "model" })).toBe("boolean");
    expect(planDecisionOutput({ mode: "model", output: "boolean" })).toBe(
      "boolean",
    );
    expect(
      planDecisionOutput({ mode: "model", output: "classification" }),
    ).toBe("classification");
  });

  it("offers true and false for yes or no and one port per value for a classification", () => {
    expect(planDecisionOutputPorts({})).toEqual(["true-out", "false-out"]);
    expect(planDecisionOutputPorts(CLASSIFYING)).toEqual([
      "case:c1",
      "case:c2",
    ]);
    expect(
      planDecisionOutputPorts({ mode: "model", output: "classification" }),
    ).toEqual([]);
  });

  it("returns the bound input of a decision", () => {
    const input = { kind: "source", nodeId: "p" } as const;
    expect(planDecisionBinding({ input })).toBe(input);
    expect(planDecisionBinding({})).toBeUndefined();
  });
});

describe("value ports", () => {
  it("round-trips the id of a value through its output port", () => {
    expect(planDecisionCasePort("c1")).toBe("case:c1");
    expect(planDecisionCaseId("case:c1")).toBe("c1");
  });

  it("names no value for other ports or an empty id", () => {
    expect(planDecisionCaseId("true-out")).toBeNull();
    expect(planDecisionCaseId("case:")).toBeNull();
  });
});

describe("the value list of a classification", () => {
  it("accepts a list within the bounds", () => {
    expect(planDecisionCasesProblem(CASES)).toBeNull();
  });

  it("refuses too few or too many values, and a missing list", () => {
    expect(planDecisionCasesProblem(undefined)).toBe("count");
    expect(planDecisionCasesProblem([SHIP])).toBe("count");
    const many = Array.from(
      { length: PLAN_DECISION_CASES.maximum + 1 },
      (_, index) => ({ id: `c${index}`, name: `Value ${index}` }),
    );
    expect(planDecisionCasesProblem(many)).toBe("count");
    expect(planDecisionCasesProblem(many.slice(0, 20))).toBeNull();
  });

  it("refuses empty, padded and overlong names", () => {
    expect(planDecisionCasesProblem([SHIP, { id: "c2", name: "   " }])).toBe(
      "name",
    );
    expect(
      planDecisionCasesProblem([SHIP, { id: "c2", name: " Rework" }]),
    ).toBe("name");
    expect(
      planDecisionCasesProblem([
        SHIP,
        { id: "c2", name: "x".repeat(PLAN_DECISION_CASE_NAME_LENGTH + 1) },
      ]),
    ).toBe("name");
    expect(
      planDecisionCasesProblem([
        SHIP,
        { id: "c2", name: "x".repeat(PLAN_DECISION_CASE_NAME_LENGTH) },
      ]),
    ).toBeNull();
  });

  it("refuses names that differ only in case and repeated ids", () => {
    expect(planDecisionCasesProblem([SHIP, { id: "c2", name: "SHIP" }])).toBe(
      "duplicate",
    );
    expect(planDecisionCasesProblem([SHIP, { id: "c1", name: "Rework" }])).toBe(
      "duplicate",
    );
  });
});

describe("boolean parameters", () => {
  it("reads true and false of a boolean parameter", () => {
    expect(planBooleanParameterValue(parameter("boolean", "true"))).toBe(true);
    expect(planBooleanParameterValue(parameter("boolean", "false"))).toBe(
      false,
    );
  });

  it("reads nothing else as a boolean", () => {
    expect(planBooleanParameterValue(parameter("boolean", "yes"))).toBeNull();
    expect(planBooleanParameterValue(parameter("string", "true"))).toBeNull();
    expect(planBooleanParameterValue(agent("a"))).toBeNull();
    expect(planBooleanParameterValue(undefined)).toBeNull();
    expect(
      planBooleanParameterValue({
        ...parameter("boolean", "true"),
        value: { type: "number", number: 1 },
      }),
    ).toBeNull();
  });
});

describe("all decisions of a plan", () => {
  it("collects decisions at the top level, in groups, in loops and in groups of loops", () => {
    const plan = planOf([
      agent("a"),
      decision("top"),
      { ...groupOf("g", []), decisions: [decision("in-group")] },
      groupOf("g-none", []),
      loopOf(
        "l",
        [
          agent("m"),
          { ...groupOf("lg", []), decisions: [decision("in-loop-group")] },
          groupOf("lg-none", []),
        ],
        [],
        {
          decisions: [decision("in-loop")],
        },
      ),
      loopOf("l-none", []),
    ]);

    expect(allPlanDecisions(plan).map((entry) => entry.id)).toEqual([
      "top",
      "in-group",
      "in-loop",
      "in-loop-group",
    ]);
  });
});

describe("the answer of a model decision", () => {
  const answer = (
    decisionValue: unknown,
    reason: unknown = " Because. ",
  ): string => JSON.stringify({ decision: decisionValue, reason });

  it("accepts a yes or no with a trimmed reason, also in padded text", () => {
    expect(readPlanDecisionAnswer(`\n${answer(true)}\n`, {})).toEqual({
      isValid: true,
      decision: true,
      reason: "Because.",
    });
    expect(readPlanDecisionAnswer(answer(false), { mode: "model" })).toEqual({
      isValid: true,
      decision: false,
      reason: "Because.",
    });
  });

  it("accepts exactly the name of a value and reports its id", () => {
    expect(readPlanDecisionAnswer(answer("Rework"), CLASSIFYING)).toEqual({
      isValid: true,
      decision: "Rework",
      caseId: "c2",
      reason: "Because.",
    });
  });

  it("refuses text that is no JSON, with fences or not an object", () => {
    for (const text of ["yes", `\`\`\`json\n${answer(true)}\n\`\`\``, ""])
      expect(readPlanDecisionAnswer(text, {})).toEqual({
        isValid: false,
        problem:
          "The answer is not exactly one JSON object; text or code fences around it are not allowed.",
      });
    for (const text of ["null", "[1]", "true", '"text"'])
      expect(readPlanDecisionAnswer(text, {})).toEqual({
        isValid: false,
        problem: "The answer is JSON but not an object.",
      });
  });

  it("refuses an object without exactly the two fields", () => {
    const problem =
      'The object must have exactly the two fields "decision" and "reason".';
    for (const text of [
      "{}",
      '{"decision":true}',
      '{"decision":true,"reason":"r","extra":1}',
      '{"decision":true,"why":"r"}',
    ])
      expect(readPlanDecisionAnswer(text, {})).toEqual({
        isValid: false,
        problem,
      });
  });

  it("refuses a missing, blank, non-text or overlong reason", () => {
    for (const reason of ["", "  ", 5, null])
      expect(readPlanDecisionAnswer(answer(true, reason), {})).toEqual({
        isValid: false,
        problem: '"reason" must be a non-empty string.',
      });
    expect(
      readPlanDecisionAnswer(
        answer(true, "r".repeat(PLAN_DECISION_REASON_LENGTH + 1)),
        {},
      ),
    ).toEqual({
      isValid: false,
      problem: `"reason" must be at most ${PLAN_DECISION_REASON_LENGTH} characters.`,
    });
    expect(
      readPlanDecisionAnswer(
        answer(true, "r".repeat(PLAN_DECISION_REASON_LENGTH)),
        {},
      ),
    ).toMatchObject({ isValid: true });
  });

  it("never reads a text as false for yes or no", () => {
    for (const value of ["false", "no", 0, null])
      expect(readPlanDecisionAnswer(answer(value), {})).toEqual({
        isValid: false,
        problem: '"decision" must be the JSON boolean true or false.',
      });
  });

  it("names the allowed values when a classification gets any other answer", () => {
    const problem =
      '"decision" must be exactly one of the allowed values: ["Ship","Rework"].';
    for (const value of ["ship", "Other", true, 1])
      expect(readPlanDecisionAnswer(answer(value), CLASSIFYING)).toEqual({
        isValid: false,
        problem,
      });
    expect(
      readPlanDecisionAnswer(answer("x"), {
        mode: "model",
        output: "classification",
      }),
    ).toEqual({
      isValid: false,
      problem: '"decision" must be exactly one of the allowed values: [].',
    });
  });
});
