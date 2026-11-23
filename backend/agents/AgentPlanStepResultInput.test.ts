import { describe, expect, it, vi } from "vitest";

import {
  isStepStatus,
  readPlanStepResult,
} from "@/backend/agents/AgentPlanStepResultInput";
import { AgentError } from "@/backend/error/AgentErrors";

// The nested schemas and readers are covered by their own modules; these
// stand-ins accept everything except the text "bad" so the wiring of this
// reader can be tested without their large fixtures.

interface StandInSchema {
  readonly safeParse: (
    input: unknown,
  ) => { success: false } | { success: true; data: { parsed: unknown } };
  readonly parse: (input: unknown) => { parsed: unknown };
}

const schemas = vi.hoisted(() => {
  const make = (): StandInSchema => ({
    safeParse: (input: unknown) =>
      input === "bad"
        ? { success: false as const }
        : { success: true as const, data: { parsed: input } },
    parse: (input: unknown) => {
      if (input === "bad") throw new Error("bad");
      return { parsed: input };
    },
  });
  return { make };
});

vi.mock("@/definition/AgentPlanSwarmRun", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  planSwarmRunSchema: schemas.make(),
}));
vi.mock("@/definition/AgentPlanJump", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  planJumpRunSchema: schemas.make(),
  planSignalRunSchema: schemas.make(),
}));
vi.mock("@/definition/AgentPlanExecution", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  planStepExecutionSchema: schemas.make(),
  planRemoteProgressSchema: schemas.make(),
}));
vi.mock("@/definition/AgentPlanScriptReport", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  planScriptAssessmentSchema: schemas.make(),
}));
vi.mock("@/definition/AgentPlanRunBranch", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  planRunBranchSchema: schemas.make(),
}));
vi.mock("@/definition/AgentPlanRemoteAccess", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assetFailureSchema: schemas.make(),
  planRemoteAccessSchema: schemas.make(),
}));
vi.mock("@/backend/agents/AgentPlanActivationInput", () => ({
  readPlanActivationFields: () => ({}),
}));
vi.mock("@/backend/agents/AgentPlanAgentTodoInput", () => ({
  readAgentTodoList: (input: unknown) => ({ todos: input }),
}));
vi.mock("@/backend/agents/AgentPlanProgressInput", () => ({
  readPlanProgress: (input: unknown) => ({ progress: input }),
}));
vi.mock("@/backend/agents/AgentPlanRetryInput", () => ({
  readPlanFailureStop: (input: unknown) => ({ stop: input }),
}));
vi.mock("@/backend/agents/AgentPlanSessionInput", () => ({
  readPlanSessionRecord: (input: unknown) => input ?? null,
}));
vi.mock("@/backend/agents/AgentPlanScriptRunInput", () => ({
  readPlanScriptRun: (input: unknown) => ({ script: input }),
}));
vi.mock("@/backend/agents/AgentPlanStackRunInput", () => ({
  readPlanStackHandover: (input: unknown) => ({ stack: input }),
}));
vi.mock("@/backend/agents/AgentConfigurationInput", () => ({
  readAgentParameterValue: (input: unknown) => ({ value: input }),
}));

function step(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "a",
    name: "Agent",
    status: "succeeded",
    cancellation: "none",
    isBlocked: false,
    output: null,
    error: null,
    ...overrides,
  };
}

describe("isStepStatus", () => {
  it("accepts the stored statuses only", () => {
    expect(isStepStatus("paused")).toBe(true);
    expect(isStepStatus("other")).toBe(false);
    expect(isStepStatus(1)).toBe(false);
  });
});

describe("readPlanStepResult", () => {
  it("reads a minimal result", () => {
    expect(readPlanStepResult(step())).toEqual({
      id: "a",
      name: "Agent",
      status: "succeeded",
      cancellation: "none",
      isBlocked: false,
      output: null,
      error: null,
      session: null,
    });
  });

  it("reads a result with every optional part", () => {
    const result = readPlanStepResult(
      step({
        output: "o",
        error: "e",
        role: "closeout",
        groupId: "g",
        failedStepId: "f",
        blockedByStepId: "b",
        isDisplayFiltered: false,
        skipped: true,
        assetFailure: "x",
        resourceAccess: "x",
        remote: "x",
        execution: "x",
        script: "x",
        runBranch: "x",
        report: "x",
        progress: "x",
        agentTodos: "x",
        failureStop: "x",
        stack: "x",
        swarm: "x",
        jump: "x",
        signal: "x",
        jumpOutputs: { a: 1 },
        returned: { b: 2 },
      }),
    );

    expect(result).toMatchObject({
      role: "closeout",
      groupId: "g",
      failedStepId: "f",
      blockedByStepId: "b",
      isDisplayFiltered: false,
      skipped: true,
      jumpOutputs: { a: { value: 1 } },
      returned: { b: { value: 2 } },
      swarm: { parsed: "x" },
      jump: { parsed: "x" },
      signal: { parsed: "x" },
      stack: { stack: "x" },
      failureStop: { stop: "x" },
    });
  });

  it("drops a skipped mark that is not true", () => {
    expect(readPlanStepResult(step({ skipped: false }))).not.toHaveProperty(
      "skipped",
    );
  });

  it.each([
    { status: "other" },
    { cancellation: "other" },
    { isBlocked: "no" },
    { isDisplayFiltered: "no" },
    { skipped: "no" },
    { output: 1 },
    { error: 1 },
    { role: "other" },
    { id: "" },
    { swarm: "bad" },
    { runBranch: "bad" },
    { report: "bad" },
    { jump: "bad" },
    { signal: "bad" },
    {
      jumpOutputs: Object.fromEntries(
        Array.from({ length: 65 }, (_, i) => [`k${String(i)}`, 1]),
      ),
    },
    { returned: { ["x".repeat(131)]: 1 } },
  ])("rejects the damaged result %j", (overrides) => {
    expect(() => readPlanStepResult(step(overrides))).toThrow(AgentError);
  });

  it.each([
    { assetFailure: "bad" },
    { resourceAccess: "bad" },
    { remote: "bad" },
    { execution: "bad" },
  ])("propagates the schema error of %j", (overrides) => {
    expect(() => readPlanStepResult(step(overrides))).toThrow();
  });
});
