// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createPlanNode,
  removePlanNode,
  snapPlanCoordinate,
} from "@/app/components/agents/plans/plan-node-factory";
import {
  planNodeHeight,
  planNodeLabel,
} from "@/app/components/agents/plans/plan-layout";
import { usePlanGraph } from "@/app/components/agents/plans/use-plan-graph";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import { planUiPage, planUiStep } from "../helpers/agent-plan-ui";

import type { AgentPlanInput } from "@/definition/AgentPlan";

function draft(): AgentPlanInput {
  return {
    ...emptyAgentPlan(),
    workspaceId: "workspace",
    globals: { branch: "main" },
  };
}

function graph(initial = draft()) {
  return renderHook(() => {
    const [plan, setPlan] = useState(initial);
    return { plan, graph: usePlanGraph(plan, setPlan, planUiPage().sources) };
  });
}

describe("A10 grid and graph editing regression", () => {
  it("creates separate UUID step instances on intranet HTTP without crypto.randomUUID", () => {
    let sequence = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (buffer: Uint8Array) => {
        buffer.fill(++sequence);
        return buffer;
      },
    });
    const sources = planUiPage().sources;
    const first = createPlanNode({
      draft: draft(),
      sources,
      kind: "agent",
      reference: "worker",
    });
    const second = createPlanNode({
      draft: draft(),
      sources,
      kind: "agent",
      reference: "worker",
    });
    expect(first?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first?.id).not.toBe(second?.id);
    expect(first).toMatchObject({ type: "agent", agentId: "worker" });
    expect(second).toMatchObject({ type: "agent", agentId: "worker" });
  });
  it("bounds numeric coordinates and refuses unknown or unusable source IDs", () => {
    expect([NaN, Infinity, -80, 19, 6100].map(snapPlanCoordinate)).toEqual([
      0, 0, 0, 20, 6000,
    ]);
    const sources = planUiPage().sources;
    const create = (
      kind: "agent" | "task" | "variable",
      reference: string,
      plan = draft(),
    ) => createPlanNode({ draft: plan, sources, kind, reference });
    expect(create("agent", "worker", emptyAgentPlan())).toBeNull();
    for (const kind of ["agent", "task", "variable"] as const)
      expect(create(kind, "missing")).toBeNull();
    expect(
      createPlanNode({
        draft: draft(),
        kind: "agent",
        reference: "worker",
        sources: {
          ...sources,
          agents: [
            {
              ...sources.agents[0],
              availability: {
                isUsable: false,
                reason: "agent_inactive",
                personalChoices: [],
              },
            },
          ],
        },
      }),
    ).toBeNull();
    expect(create("task", "task")).toMatchObject({
      type: "task",
      taskId: "task",
    });
    expect(create("variable", "branch")).toMatchObject({
      type: "variable",
      name: "branch",
    });
    expect(
      createPlanNode({
        draft: draft(),
        kind: "agent",
        reference: "worker",
        sources: {
          ...sources,
          agents: [
            {
              ...sources.agents[0],
              configuration: {
                ...sources.agents[0].configuration,
                directoryParameter: "root",
              },
            },
          ],
        },
      }),
    ).toMatchObject({
      bindings: {
        root: {
          kind: "literal",
          value: { type: "workspace", workspaceId: "workspace" },
        },
      },
    });
  });

  it("preserves literal values but removes all edges and input references to a deleted node", () => {
    const a = {
      ...planUiStep(),
      bindings: {
        input: { kind: "source", nodeId: "task" },
        result: { kind: "result", stepId: "B" },
        literal: { kind: "literal", value: null },
      },
    } as const;
    const task = {
      id: "task",
      type: "task",
      taskId: "task",
      x: 0,
      y: 0,
    } as const;
    const plan = {
      ...draft(),
      nodes: [a, planUiStep("B"), task],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "A" },
      ],
    };
    const noTask = removePlanNode(plan, "task");
    expect(noTask.nodes[0]).toMatchObject({
      bindings: { result: a.bindings.result, literal: a.bindings.literal },
    });
    const noResult = removePlanNode(plan, "B");
    expect(noResult.edges).toEqual([]);
    expect(noResult.nodes[0]).toMatchObject({
      bindings: { input: a.bindings.input, literal: a.bindings.literal },
    });
    expect(noResult.nodes[1]).toEqual(task);
    expect(plan.nodes).toHaveLength(3);
    expect(planNodeHeight(a, { agents: [], tasks: [] })).toBe(168);
    expect(planNodeLabel(a, { agents: [], tasks: [] })).toBe("worker");
    expect(planNodeLabel(task, { agents: [], tasks: [] })).toBe("task");
  });

  it("creates independent instances, edits instructions, snaps movement and clears deleted selections", () => {
    const { result } = graph();
    act(() => {
      result.current.graph.add("agent", "worker");
    });
    const first = result.current.plan.nodes[0];
    act(() => {
      result.current.graph.add("agent", "worker");
    });
    expect(result.current.plan.nodes[1].id).not.toBe(first.id);
    act(() => {
      result.current.graph.move(first.id, -10, 39);
    });
    expect(result.current.plan.nodes[0]).toMatchObject({ x: 0, y: 40 });
    act(() => {
      result.current.graph.replaceStep({
        ...planUiStep(first.id),
        instruction: "New instruction",
      });
    });
    expect(result.current.plan.nodes[0]).toMatchObject({
      instruction: "New instruction",
    });
    act(() => {
      result.current.graph.begin({ kind: "flow", nodeId: first.id });
      result.current.graph.select(first.id);
    });
    act(() => {
      result.current.graph.remove(first.id);
    });
    expect(result.current.graph.selectedId).toBeNull();
    expect(result.current.graph.connection).toBeNull();
    act(() => {
      expect(result.current.graph.add("agent", "missing")).toBeNull();
      result.current.graph.remove("missing");
    });
    expect(result.current.plan.nodes).toHaveLength(1);
  });

  it("keeps execution ordering and data wiring distinct, ignores duplicate flow edges and invalid binds", () => {
    const initial = {
      ...draft(),
      nodes: [
        planUiStep(),
        planUiStep("B"),
        { id: "task", type: "task", taskId: "task", x: 0, y: 0 } as const,
      ],
    };
    const { result } = graph(initial);
    act(() => {
      result.current.graph.connect("B");
    });
    act(() => {
      result.current.graph.begin({ kind: "flow", nodeId: "A" });
    });
    act(() => {
      result.current.graph.connect("A");
    });
    expect(result.current.graph.connection).not.toBeNull();
    act(() => {
      result.current.graph.connect("B");
    });
    act(() => {
      result.current.graph.begin({ kind: "flow", nodeId: "A" });
    });
    act(() => {
      result.current.graph.connect("B");
    });
    expect(result.current.plan.edges).toEqual([{ from: "A", to: "B" }]);
    act(() => {
      result.current.graph.begin({ kind: "source", nodeId: "task" });
    });
    act(() => {
      result.current.graph.connect("B", "input");
    });
    expect(result.current.plan.nodes[1]).toMatchObject({
      bindings: { input: { kind: "source", nodeId: "task" } },
    });
    act(() => {
      result.current.graph.begin({ kind: "result", nodeId: "A" });
    });
    act(() => {
      result.current.graph.connect("B", "input");
    });
    expect(result.current.plan.nodes[1]).toMatchObject({
      bindings: { input: { kind: "result", stepId: "A" } },
    });
    act(() => {
      result.current.graph.begin({ kind: "flow", nodeId: "A" });
    });
    act(() => {
      result.current.graph.connect("B", "input");
      result.current.graph.bindSource("missing", "B", "input");
    });
    act(() => {
      result.current.graph.bindSource("task", "B", "input");
    });
    expect(result.current.plan.nodes[1]).toMatchObject({
      bindings: { input: { kind: "source", nodeId: "task" } },
    });
    act(() => {
      result.current.graph.begin({ kind: "source", nodeId: "task" });
    });
    act(() => {
      result.current.graph.connect("B");
    });
    expect(result.current.graph.connection).toBeNull();
  });
});
