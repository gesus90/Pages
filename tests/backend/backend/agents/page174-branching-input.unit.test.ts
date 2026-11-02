import { describe, expect, it } from "vitest";

import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { requireCloneablePlan } from "@/backend/agents/AgentPlanCloneShape";
import { clonePlanGraph } from "@/backend/service/agents/AgentPlanClone";

import type { AgentPlanInput, AgentPlanRun } from "@/definition/AgentPlan";

const PLAN: AgentPlanInput = {
  name: "Review",
  workspaceId: "workspace",
  usage: "private",
  globals: {},
  nodes: [
    { id: "start", type: "start", x: 0, y: 0 },
    { id: "decision", type: "decision", name: "Passed?", x: 300, y: 0 },
    { id: "end", type: "end", x: 600, y: 0 },
  ],
  edges: [
    {
      from: "decision",
      to: "end",
      fromPort: "true-out",
      toPort: "flow-in",
    },
  ],
};

describe("decision plans as input", () => {
  it("reads a decision with its optional name and keeps the ports of its edges", () => {
    const read = readPlanInput(JSON.parse(JSON.stringify(PLAN)));
    expect(read.nodes[1]).toEqual({
      id: "decision",
      type: "decision",
      name: "Passed?",
      x: 300,
      y: 0,
    });
    expect(read.edges).toEqual(PLAN.edges);
    const unnamed = readPlanInput({
      ...PLAN,
      nodes: [{ id: "decision", type: "decision", x: 1, y: 2 }],
      edges: [],
    });
    expect(unnamed.nodes[0]).toEqual({
      id: "decision",
      type: "decision",
      x: 1,
      y: 2,
    });
    expect(() =>
      readPlanInput({
        ...PLAN,
        nodes: [{ id: "decision", type: "decision", name: "", x: 1, y: 2 }],
        edges: [],
      }),
    ).toThrow();
  });

  it("clones a plan with a decision without losing a field or a port", () => {
    expect(() => requireCloneablePlan(PLAN)).not.toThrow();
    const cloned = clonePlanGraph(PLAN, { name: "Copy", expectedRevision: 1 });
    expect(cloned.nodes[1]).toMatchObject({
      type: "decision",
      name: "Passed?",
    });
    expect(cloned.edges[0]).toMatchObject({
      fromPort: "true-out",
      toPort: "flow-in",
    });
    expect(cloned.edges[0]?.from).toBe(cloned.nodes[1]?.id);
  });
});

describe("runs of cycles as stored", () => {
  const run: AgentPlanRun = {
    id: "run",
    planId: "plan",
    planName: "Review",
    planRevision: 1,
    userId: "owner",
    startedAt: "2026-11-01T00:00:00Z",
    status: "succeeded",
    stopRequested: false,
    steps: [
      {
        id: "decision",
        name: "Decision",
        status: "succeeded",
        isBlocked: false,
        cancellation: "none",
        output: null,
        error: null,
        session: null,
        activation: 2,
        branch: "true",
        condition: { sourceStepId: "check", sourceActivation: 2, value: true },
        history: [
          {
            activation: 1,
            status: "succeeded",
            output: null,
            error: null,
            branch: "false",
            condition: {
              sourceStepId: "check",
              sourceActivation: 1,
              value: false,
            },
            startedAt: null,
            endedAt: null,
          },
        ],
      },
      {
        id: "check",
        name: "Check",
        status: "succeeded",
        isBlocked: false,
        cancellation: "none",
        output: "ok",
        error: null,
        session: null,
        activation: 2,
        passed: true,
        trigger: {
          kind: "event",
          sources: [{ stepId: "fix", activation: 1 }],
          promptLength: 42,
        },
      },
      {
        id: "fix",
        name: "Fix",
        status: "skipped",
        isBlocked: false,
        cancellation: "none",
        output: null,
        error: null,
        session: null,
      },
    ],
  };

  it("keeps activation, boolean result, branch, condition, trigger, history and skipped nodes through storage", () => {
    expect(readPlanRun(JSON.parse(JSON.stringify(run)))).toEqual(run);
  });

  it("refuses a branch, count or trigger that is not what the scheduler writes", () => {
    for (const broken of [
      { branch: "maybe" },
      { activation: 0 },
      { activation: 99 },
      { passed: "yes" },
      { trigger: { kind: "event", sources: [], promptLength: 1 } },
    ]) {
      const [first, ...rest] = run.steps;
      expect(() =>
        readPlanRun({ ...run, steps: [{ ...first, ...broken }, ...rest] }),
      ).toThrow();
    }
  });
});
