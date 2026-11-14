import { expect, it } from "vitest";

import {
  appliedPlanDecisionForm,
  isPlanDecisionCaseConnected,
  isPlanDecisionClassification,
  planDecisionCaseNameProblem,
  planDecisionFormOf,
  planDecisionInputChoices,
  planDecisionInputValue,
  planDecisionModelRefusal,
  planDecisionModels,
} from "@/app/components/agents/plans/plan-decision-dialog/plan-decision-form";
import { PLAN_DECISION_CASE_NAME_LENGTH } from "@/definition/AgentPlanDecision";

import { DECISION, reviewCyclePlan } from "./plan-branching-fixture";
import { GROUP_SOURCES, agentNode, i18n, planOf } from "./plan-group-fixture";
import { pageModel } from "./plan-model-fixture";

import type { AgentPlanDecision } from "@/definition/AgentPlan";

it("validates trimmed case names independently of their ids", () => {
  expect(planDecisionCaseNameProblem([{ id: "a", name: "  " }])).toBe("empty");
  expect(
    planDecisionCaseNameProblem([
      { id: "a", name: "x".repeat(PLAN_DECISION_CASE_NAME_LENGTH + 1) },
    ]),
  ).toBe("length");
  expect(
    planDecisionCaseNameProblem([
      { id: "a", name: " Yes " },
      { id: "b", name: "yes" },
    ]),
  ).toBe("duplicate");
  expect(
    planDecisionCaseNameProblem([
      { id: "a", name: "Yes" },
      { id: "b", name: "No" },
    ]),
  ).toBeNull();
});

it("encodes saved inputs and offers appropriate sources for each mode", () => {
  const plan = planOf([
    agentNode("agent", "codex"),
    {
      id: "boolean",
      type: "parameter",
      name: "Ready",
      format: "boolean",
      value: { type: "text", text: "true" },
      x: 0,
      y: 0,
    },
    {
      id: "text",
      type: "parameter",
      name: "Text",
      format: "string",
      value: { type: "text", text: "x" },
      x: 0,
      y: 0,
    },
    DECISION,
  ]);
  expect(
    planDecisionInputValue(plan, {
      ...DECISION,
      input: { kind: "source", nodeId: "boolean" },
    }),
  ).toBe("source:boolean");
  expect(
    planDecisionInputValue(plan, {
      ...DECISION,
      input: { kind: "result", stepId: "agent" },
    }),
  ).toBe("result:agent");
  expect(planDecisionInputValue(plan, DECISION)).toBe("");
  expect(
    planDecisionInputChoices(
      plan,
      GROUP_SOURCES,
      "boolean",
      i18n.t.bind(i18n),
    ).map((choice) => choice.value),
  ).toEqual(["", "agent", "source:boolean"]);
  expect(
    planDecisionInputChoices(
      plan,
      GROUP_SOURCES,
      "model",
      i18n.t.bind(i18n),
    ).map((choice) => choice.value),
  ).toEqual(["", "result:agent"]);
  expect(planDecisionInputValue(reviewCyclePlan(), DECISION)).toBe("check");
});

it("reads model settings and rejects unavailable model connections", () => {
  const model = pageModel("one", { provider: "codex_cli" });
  const decision: AgentPlanDecision = {
    ...DECISION,
    mode: "model",
    model: {
      connectionId: "connection",
      provider: "codex_cli",
      model: model.model,
      reasoningEffort: null,
    },
    output: "classification",
    cases: [{ id: "a", name: "Yes" }],
  };
  const form = planDecisionFormOf(planOf([decision]), decision, [model]);
  expect(form.modelId).toBe("one");
  expect(isPlanDecisionClassification(form)).toBe(true);
  expect(planDecisionModels({ ...GROUP_SOURCES, models: [model] })).toEqual([
    model,
  ]);
  expect(planDecisionModels(GROUP_SOURCES)).toEqual(GROUP_SOURCES.models ?? []);
  expect(planDecisionModelRefusal(model)).toBe(false);
  expect(
    planDecisionModelRefusal(pageModel("missing", { connectionId: "" })),
  ).toBe(true);
  expect(planDecisionModelRefusal(pageModel("other"))).toBe(true);
});

it("applies classification edits and removes only deleted case connections", () => {
  const decision: AgentPlanDecision = {
    ...DECISION,
    mode: "model",
    output: "classification",
    cases: [
      { id: "a", name: "Old" },
      { id: "b", name: "Remove" },
    ],
  };
  const plan = planOf(
    [decision],
    [
      { from: decision.id, to: "first", fromPort: "case:a", toPort: "flow-in" },
      {
        from: decision.id,
        to: "second",
        fromPort: "case:b",
        toPort: "flow-in",
      },
    ],
  );
  const form = {
    ...planDecisionFormOf(plan, decision, []),
    name: "  Review  ",
    question: " Decide ",
    input: "result:agent",
    cases: [{ id: "a", name: " Renamed " }],
  };
  expect(isPlanDecisionCaseConnected(plan, decision.id, "a")).toBe(true);
  const next = appliedPlanDecisionForm(plan, decision, { form, models: [] });
  expect(next.nodes).toContainEqual({
    ...decision,
    name: "Review",
    question: " Decide ",
    input: { kind: "result", stepId: "agent" },
    cases: [{ id: "a", name: "Renamed" }],
  });
  expect(isPlanDecisionCaseConnected(next, decision.id, "a")).toBe(true);
  expect(isPlanDecisionCaseConnected(next, decision.id, "b")).toBe(false);
});
