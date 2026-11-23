import { describe, expect, it } from "vitest";

import { readPlanActivationFields } from "@/backend/agents/AgentPlanActivationInput";
import { AgentError } from "@/backend/error/AgentErrors";

const VERDICT = {
  decision: true,
  reason: "because",
  model: "m",
  sourceStepId: "s",
  isCorrected: false,
};

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof AgentError ? error.code : undefined;
  }
  return undefined;
}

function rejects(step: Record<string, unknown>): void {
  expect(codeOf(() => readPlanActivationFields(step))).toBe("plan_invalid");
}

describe("readPlanActivationFields", () => {
  it("returns nothing for a node that stored no activation facts", () => {
    expect(readPlanActivationFields({})).toEqual({});
  });

  it("reads count, passed state, branch, condition, trigger and history", () => {
    const step = {
      activation: 2,
      passed: true,
      branch: "case:a",
      condition: {
        sourceStepId: " s ",
        sourceActivation: 1,
        value: false,
        sourceKind: "parameter",
      },
      trigger: {
        kind: "event",
        sources: [{ stepId: "a", activation: 3 }],
        promptLength: 0,
      },
      history: [
        {
          activation: 1,
          status: "failed",
          output: "out",
          error: null,
          startedAt: "t0",
          endedAt: "t1",
          passed: false,
          branch: "true",
        },
        { activation: 2, status: "waiting", output: null, error: "e" },
      ],
    };
    expect(readPlanActivationFields(step)).toEqual({
      activation: 2,
      passed: true,
      branch: "case:a",
      condition: {
        sourceStepId: "s",
        sourceActivation: 1,
        value: false,
        sourceKind: "parameter",
      },
      trigger: step.trigger,
      history: [
        { ...step.history[0] },
        {
          activation: 2,
          status: "waiting",
          output: null,
          error: "e",
          startedAt: null,
          endedAt: null,
        },
      ],
    });
  });

  it("reads a condition without a source kind", () => {
    const result = readPlanActivationFields({
      condition: { sourceStepId: "s", sourceActivation: 1, value: true },
    });
    expect(result.condition).toEqual({
      sourceStepId: "s",
      sourceActivation: 1,
      value: true,
    });
  });

  it("reads a verdict with and without optional fields", () => {
    expect(readPlanActivationFields({ verdict: VERDICT }).verdict).toEqual(
      VERDICT,
    );
    expect(
      readPlanActivationFields({
        verdict: {
          ...VERDICT,
          decision: "yes",
          caseId: "c",
          probability: 0.5,
          confidence: 1,
          costUsd: 0,
          sourceActivation: 4,
          isCorrected: true,
        },
      }).verdict,
    ).toEqual({
      decision: "yes",
      caseId: "c",
      reason: "because",
      probability: 0.5,
      confidence: 1,
      costUsd: 0,
      model: "m",
      sourceStepId: "s",
      sourceActivation: 4,
      isCorrected: true,
    });
  });
});

describe("readPlanActivationFields rejections", () => {
  it("rejects malformed activation facts", () => {
    rejects({ history: "x" });
    rejects({ history: Array.from({ length: 26 }, () => ({})) });
    rejects({ activation: 0 });
    rejects({ activation: 26 });
    rejects({ activation: 1.5 });
    rejects({ activation: "1" });
    rejects({ passed: "yes" });
    rejects({ branch: "nowhere" });
    rejects({ branch: `case:${"x".repeat(120)}` });
  });

  it("rejects a malformed condition", () => {
    const base = { sourceStepId: "s", sourceActivation: 1, value: true };
    rejects({ condition: { ...base, value: "yes" } });
    rejects({ condition: { ...base, sourceKind: "other" } });
    rejects({ condition: { ...base, sourceStepId: "" } });
  });

  it("rejects a malformed trigger", () => {
    const sources = [{ stepId: "a", activation: 1 }];
    const base = { kind: "event", sources, promptLength: 1 };
    rejects({ trigger: { ...base, kind: "timer" } });
    rejects({ trigger: { ...base, sources: "x" } });
    rejects({ trigger: { ...base, sources: [] } });
    rejects({
      trigger: {
        ...base,
        sources: Array.from({ length: 101 }, () => sources[0]),
      },
    });
    rejects({ trigger: { ...base, promptLength: "1" } });
    rejects({ trigger: { ...base, promptLength: 1.5 } });
    rejects({ trigger: { ...base, promptLength: -1 } });
  });

  it("rejects a malformed verdict", () => {
    rejects({ verdict: { ...VERDICT, decision: 1 } });
    rejects({ verdict: { ...VERDICT, decision: "x".repeat(61) } });
    rejects({ verdict: { ...VERDICT, reason: 1 } });
    rejects({ verdict: { ...VERDICT, reason: "x".repeat(2001) } });
    rejects({ verdict: { ...VERDICT, isCorrected: "no" } });
    rejects({ verdict: { ...VERDICT, probability: "1" } });
    rejects({ verdict: { ...VERDICT, probability: Number.NaN } });
    rejects({ verdict: { ...VERDICT, probability: -0.1 } });
    rejects({ verdict: { ...VERDICT, confidence: 1.1 } });
    rejects({ verdict: { ...VERDICT, model: "" } });
  });

  it("rejects malformed history entries", () => {
    const entry = {
      activation: 1,
      status: "running",
      output: null,
      error: null,
    };
    rejects({ history: [{ ...entry, status: "unknown" }] });
    rejects({ history: [{ ...entry, output: 1 }] });
    rejects({ history: [{ ...entry, error: 1 }] });
    rejects({ history: [{ ...entry, startedAt: 1 }] });
  });
});
