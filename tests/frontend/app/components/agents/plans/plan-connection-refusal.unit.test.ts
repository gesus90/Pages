import { expect, it } from "vitest";

import { planRefusalKey } from "@/app/components/agents/plans/plan-connection-refusal";

import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

function issue(
  reason: AgentPlanIssue["reason"],
  port: string | null,
): AgentPlanIssue {
  return { nodeId: "node", port, reason };
}

it("names what the condition, the event input and a flow IN take when the type is wrong", () => {
  expect(planRefusalKey(issue("type", "condition-in"))).toBe(
    "plans.validation.decisionCondition",
  );
  expect(planRefusalKey(issue("type", "event-in"))).toBe(
    "plans.validation.typeEvent",
  );
  expect(planRefusalKey(issue("type", "flow-in"))).toBe(
    "plans.validation.typeFlow",
  );
});

it("keeps the general sentence for a parameter IN and for every other finding", () => {
  expect(planRefusalKey(issue("type", "topic"))).toBe("plans.validation.type");
  expect(planRefusalKey(issue("cycle", "flow-in"))).toBe(
    "plans.validation.cycle",
  );
  expect(planRefusalKey(issue("duplicate", "condition-in"))).toBe(
    "plans.validation.duplicate",
  );
});
