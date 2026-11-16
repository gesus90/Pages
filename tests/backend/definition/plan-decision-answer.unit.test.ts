import { expect, it } from "vitest";

import {
  planBooleanParameterValue,
  planDecisionCaseId,
  planDecisionCasePort,
  planDecisionCasesProblem,
  planDecisionOutputPorts,
  readPlanDecisionAnswer,
} from "@/definition/AgentPlanDecision";

const CLASSIFIER = {
  mode: "model" as const,
  output: "classification" as const,
  cases: [
    { id: "a", name: "Accept" },
    { id: "b", name: "Reject" },
  ],
};

it("validates classification values and maps stable output ports", () => {
  expect(planDecisionCasesProblem(CLASSIFIER.cases)).toBeNull();
  expect(planDecisionCasesProblem(undefined)).toBe("count");
  expect(
    planDecisionCasesProblem([
      { id: "a", name: " A" },
      { id: "b", name: "B" },
    ]),
  ).toBe("name");
  expect(
    planDecisionCasesProblem([
      { id: "a", name: "Same" },
      { id: "b", name: "same" },
    ]),
  ).toBe("duplicate");
  expect(
    planDecisionCasesProblem([
      { id: "a", name: "A" },
      { id: "a", name: "B" },
    ]),
  ).toBe("duplicate");
  expect(planDecisionOutputPorts(CLASSIFIER)).toEqual(["case:a", "case:b"]);
  expect(planDecisionOutputPorts({})).toEqual(["true-out", "false-out"]);
  expect(planDecisionCaseId(planDecisionCasePort("a"))).toBe("a");
  expect(planDecisionCaseId("case:")).toBeNull();
});

it("reads exact boolean and classification answers", () => {
  expect(
    readPlanDecisionAnswer('{"decision":false,"reason":" checked "}', {}),
  ).toEqual({ isValid: true, decision: false, reason: "checked" });
  expect(
    readPlanDecisionAnswer(
      '{"decision":"Accept","reason":" yes "}',
      CLASSIFIER,
    ),
  ).toEqual({ isValid: true, decision: "Accept", caseId: "a", reason: "yes" });
  for (const text of [
    "prose",
    "[]",
    "{}",
    '{"decision":true,"reason":""}',
    '{"decision":"true","reason":"yes"}',
    JSON.stringify({ decision: true, reason: "x".repeat(2001) }),
  ])
    expect(readPlanDecisionAnswer(text, {}).isValid).toBe(false);
  expect(
    readPlanDecisionAnswer('{"decision":"accept","reason":"yes"}', CLASSIFIER)
      .isValid,
  ).toBe(false);
});

it("accepts only exact boolean parameter text", () => {
  const node = {
    id: "p",
    type: "parameter" as const,
    name: "P",
    x: 0,
    y: 0,
    format: "boolean" as const,
    value: { type: "text" as const, text: "true" },
  };
  expect(planBooleanParameterValue(node)).toBe(true);
  expect(
    planBooleanParameterValue({
      ...node,
      value: { type: "text", text: "false" },
    }),
  ).toBe(false);
  expect(
    planBooleanParameterValue({
      ...node,
      value: { type: "text", text: "TRUE" },
    }),
  ).toBeNull();
  expect(planBooleanParameterValue(undefined)).toBeNull();
});
