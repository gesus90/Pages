import { describe, expect, it } from "vitest";

import { readPlanInput, readPlanText } from "@/backend/agents/AgentPlanInput";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import {
  validatePlanGraph,
  hasPlanPath,
} from "@/backend/service/agents/AgentPlanGraph";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import { executionPlan, executionStep } from "../helpers/execution-plans";

import type { AgentPlanInput, AgentPlanRun } from "@/definition/AgentPlan";

function plan(overrides: Partial<AgentPlanInput> = {}): AgentPlanInput {
  return executionPlan("workspace", "agent", overrides);
}

function run(): AgentPlanRun {
  return {
    id: "run",
    planId: "plan",
    planName: "Plan",
    userId: "bob",
    startedAt: "2026-10-11T14:00:00Z",
    planRevision: 1,
    status: "running",
    stopRequested: false,
    steps: [
      {
        id: "A",
        name: "Worker",
        status: "waiting",
        cancellation: "none",
        isBlocked: false,
        output: null,
        error: null,
      },
    ],
  };
}

describe("A10 plan request boundaries", () => {
  it("rejects malformed labels, graph limits and revisions before resource access", () => {
    for (const input of [null, 1, "", " ", "x\u0000", "x".repeat(101)])
      expect(() => readPlanText(input)).toThrow(
        expect.objectContaining({ code: "plan_invalid" }),
      );
    expect(readPlanText(" name ")).toBe("name");
    for (const overrides of [
      { nodes: null },
      { nodes: Array(101).fill(null) },
      { edges: null },
      { edges: Array(501).fill(null) },
      { usage: "global" },
      ...["1", 0, 1.5, Number.MAX_SAFE_INTEGER + 1].map((revision) => ({
        revision,
      })),
    ])
      expect(() => readPlanInput({ ...plan(), ...overrides })).toThrow();
    expect(readPlanInput(plan({ revision: 2 }))).toEqual(plan({ revision: 2 }));
    expect(() => readPlanInput(emptyAgentPlan())).toThrow();
  });

  it("rejects malformed positions, node types, instructions and parameter ports", () => {
    const base = executionStep("A", "agent");
    for (const overrides of [
      { x: "0" },
      { y: "0" },
      { x: 0.5 },
      { y: 0.5 },
      { x: -1 },
      { y: -1 },
      { x: 6001 },
      { y: 6001 },
      { type: "unknown" },
      { instruction: null },
      { instruction: "x".repeat(200001) },
      {
        bindings: Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`p${index}`, null]),
        ),
      },
      { bindings: { "bad.name": null } },
      { bindings: { input: { kind: "unknown" } } },
    ])
      expect(() =>
        readPlanInput({ ...plan(), nodes: [{ ...base, ...overrides }] }),
      ).toThrow();
    expect(
      readPlanInput(
        plan({
          nodes: [
            {
              ...base,
              personalAgentId: "personal",
              bindings: {
                text: {
                  kind: "literal",
                  value: { type: "text", text: "hello" },
                },
                empty: { kind: "literal", value: null },
                source: { kind: "source", nodeId: "task" },
                result: { kind: "result", stepId: "previous" },
              },
            },
          ],
        }),
      ).nodes[0],
    ).toMatchObject({ personalAgentId: "personal" });
    expect(() =>
      readPlanInput(
        plan({
          nodes: [{ id: "V", type: "variable", name: "Bad", x: 0, y: 0 }],
        }),
      ),
    ).toThrow();
    expect(
      readPlanInput(
        plan({
          nodes: [{ id: "V", type: "variable", name: "branch", x: 0, y: 0 }],
        }),
      ).nodes,
    ).toHaveLength(1);
  });

  it("validates global variable names and bounded text without interpreting its contents", () => {
    for (const globals of [
      Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [`p${index}`, "text"]),
      ),
      { "bad.name": "text" },
      { branch: 7 },
      { branch: "x".repeat(200001) },
    ])
      expect(() => readPlanInput({ ...plan(), globals })).toThrow();
    expect(
      readPlanInput(plan({ globals: { branch: "{{literal}}" } })).globals,
    ).toEqual({ branch: "{{literal}}" });
  });
});

describe("A10 persisted public run boundaries", () => {
  it("accepts every execution and cancellation state and rejects corrupted views", () => {
    for (const status of ["running", "succeeded", "failed", "cancelled"])
      expect(readPlanRun({ ...run(), status }).status).toBe(status);
    for (const status of [
      "waiting",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ])
      expect(
        readPlanRun({ ...run(), steps: [{ ...run().steps[0], status }] })
          .steps[0].status,
      ).toBe(status);
    for (const cancellation of [
      "none",
      "requested",
      "confirmed",
      "not_started",
    ])
      expect(
        readPlanRun({
          ...run(),
          steps: [
            {
              ...run().steps[0],
              cancellation,
              output: "result",
              error: "plan_step_failed",
            },
          ],
        }).steps[0].cancellation,
      ).toBe(cancellation);
    for (const overrides of [
      { status: "unknown" },
      { planRevision: "1" },
      { planRevision: 1.5 },
      { planRevision: 0 },
      { stopRequested: null },
      { steps: null },
      { steps: Array(101).fill(null) },
    ])
      expect(() => readPlanRun({ ...run(), ...overrides })).toThrow();
    for (const overrides of [
      { status: "unknown" },
      { cancellation: "unknown" },
      { isBlocked: null },
      { output: 7 },
      { error: 7 },
    ])
      expect(() =>
        readPlanRun({ ...run(), steps: [{ ...run().steps[0], ...overrides }] }),
      ).toThrow();
  });

  it("extracts deduplicated authorization IDs and tolerates absent optional snapshot arrays", () => {
    const snapshot = {
      plan: { workspaceId: "workspace", projectId: "project" },
    };
    expect(readPlanRunResources(snapshot)).toEqual({
      projectId: "project",
      workspaceIds: ["workspace"],
      taskIds: [],
      wikiIds: [],
    });
    expect(
      readPlanRunResources({
        ...snapshot,
        steps: [
          {
            prepared: {
              parameters: {
                values: {
                  empty: null,
                  text: { type: "text", text: "secret task" },
                },
              },
            },
          },
          {
            taskIds: ["task", "task"],
            prepared: {
              parameters: {
                values: {
                  directory: { type: "workspace", workspaceId: "other" },
                  wiki: { type: "wiki", pageId: "page" },
                },
              },
            },
          },
        ],
      }),
    ).toEqual({
      projectId: "project",
      workspaceIds: ["workspace", "other"],
      taskIds: ["task"],
      wikiIds: ["page"],
    });
    expect(() =>
      readPlanRunResources({ ...snapshot, steps: [{ taskIds: [null] }] }),
    ).toThrow();
  });
});

describe("A10 graph integrity", () => {
  it("rejects duplicate nodes and edges, self cycles and references to nonexecution ports", () => {
    const a = executionStep("A", "agent");
    const b = executionStep("B", "agent");
    const task = {
      id: "task",
      type: "task",
      taskId: "ticket",
      x: 0,
      y: 0,
    } as const;
    for (const proposed of [
      plan({ nodes: [a, a] }),
      plan({
        nodes: [a, b],
        edges: [
          { from: "A", to: "B" },
          { from: "A", to: "B" },
        ],
      }),
      plan({ nodes: [a], edges: [{ from: "A", to: "A" }] }),
      plan({ nodes: [a, task], edges: [{ from: "A", to: "task" }] }),
      plan({ nodes: [a, task], edges: [{ from: "task", to: "A" }] }),
      plan({
        nodes: [
          executionStep("A", "agent", {
            input: { kind: "source", nodeId: "A" },
          }),
        ],
      }),
      plan({
        nodes: [{ id: "V", type: "variable", name: "missing", x: 0, y: 0 }],
      }),
    ])
      expect(() => validatePlanGraph(proposed)).toThrow();
    expect(
      hasPlanPath(
        [
          { from: "A", to: "B" },
          { from: "B", to: "A" },
        ],
        "A",
        "missing",
      ),
    ).toBe(false);
    expect(
      hasPlanPath(
        [
          { from: "A", to: "B" },
          { from: "B", to: "C" },
        ],
        "A",
        "C",
      ),
    ).toBe(true);
    expect(() =>
      validatePlanGraph(
        plan({ nodes: [a, b], edges: [{ from: "A", to: "B" }] }),
      ),
    ).not.toThrow();
  });
});
