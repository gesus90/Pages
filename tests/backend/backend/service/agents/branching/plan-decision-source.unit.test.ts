import { expect, it, vi } from "vitest";

import {
  readDecisionSource,
  decisionPrompt,
} from "@/backend/service/agents/branching/AgentPlanDecisionPrompt";
import { decidePlanBoolean } from "@/backend/service/agents/branching/AgentPlanDecisionValue";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { AgentPlanDecision } from "@/definition/AgentPlan";

type SourceRequest = Parameters<typeof readDecisionSource>[1];

it("uses the current boolean parameter rather than treating absence as false", () => {
  const decision = partial<AgentPlanDecision>({
    id: "decision",
    mode: "boolean",
    input: { kind: "source", nodeId: "parameter" },
  });
  const scope = partial<Parameters<typeof decidePlanBoolean>[1]>({
    plan: {
      nodes: [
        {
          id: "parameter",
          type: "parameter",
          format: "boolean",
          value: { type: "text", text: "false" },
        },
      ],
    },
    edges: [],
    results: new Map(),
  });
  expect(decidePlanBoolean(decision, scope)).toMatchObject({
    status: "succeeded",
    branch: "false",
    condition: { value: false },
  });
  expect(
    decidePlanBoolean(decision, { ...scope, plan: { nodes: [] } }),
  ).toMatchObject({ status: "failed", error: "plan_decision_input_invalid" });
});

it("reads the successful current result and builds a constrained decision prompt", async () => {
  const request = partial<SourceRequest>({
    decision: {
      mode: "model",
      question: "  Ready?  ",
      input: { kind: "result", stepId: "step" },
    },
    results: new Map([
      [
        "step",
        {
          id: "step",
          name: "Work",
          status: "succeeded",
          activation: 2,
          output: "Result",
        },
      ],
    ]),
  });
  const snapshot = vi.fn();
  const source = await readDecisionSource({ snapshot }, request);
  expect(source).toMatchObject({
    nodeId: "step",
    activation: 2,
    text: "Result",
  });
  if (!source) throw new Error("Expected decision source");
  expect(decisionPrompt(request.decision, source)).toContain("Ready?");
  expect(snapshot).not.toHaveBeenCalled();
  await expect(
    readDecisionSource({ snapshot }, { ...request, results: new Map() }),
  ).resolves.toBeNull();
});
