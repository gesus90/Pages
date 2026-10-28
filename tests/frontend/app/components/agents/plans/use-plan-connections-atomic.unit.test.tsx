import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";

import { usePlanGraph } from "@/app/components/agents/plans/use-plan-graph";

import { GROUP_SOURCES, agentNode, planOf } from "./plan-group-fixture";

import type { AgentPlanInput } from "@/definition/AgentPlan";

function useDraft(initial: AgentPlanInput): {
  readonly draft: AgentPlanInput;
  readonly graph: ReturnType<typeof usePlanGraph>;
} {
  const [draft, setDraft] = useState(initial);
  return { draft, graph: usePlanGraph(draft, setDraft, GROUP_SOURCES) };
}

it("keeps two distinct flow connections queued before the next render", () => {
  const plan = planOf([
    { id: "start", type: "start", x: 0, y: 0 },
    agentNode("agent", "codex"),
    { id: "end", type: "end", x: 400, y: 0 },
  ]);
  const { result } = renderHook(() => useDraft(plan));

  act(() => {
    result.current.graph.connectFrom(
      { kind: "flow", nodeId: "start" },
      "agent",
    );
    result.current.graph.connectFrom({ kind: "flow", nodeId: "agent" }, "end");
  });

  expect(result.current.draft.edges).toMatchObject([
    { from: "start", to: "agent" },
    { from: "agent", to: "end" },
  ]);
});

it("keeps two named inputs from the same source queued before the next render", () => {
  const plan = planOf([
    {
      id: "source",
      type: "parameter",
      x: 0,
      y: 0,
      name: "source",
      format: "string",
      value: { type: "text", text: "evidence" },
    },
    agentNode("agent", "codex-two"),
  ]);
  const { result } = renderHook(() => useDraft(plan));

  act(() => {
    const source = { kind: "source", nodeId: "source" } as const;
    result.current.graph.connectFrom(source, "agent", "input1");
    result.current.graph.connectFrom(source, "agent", "input2");
  });

  expect(result.current.draft.nodes[1]).toMatchObject({
    bindings: {
      input1: { kind: "source", nodeId: "source" },
      input2: { kind: "source", nodeId: "source" },
    },
  });
});

it("does not persist an exact duplicate queued twice before the next render", () => {
  const plan = planOf([
    { id: "start", type: "start", x: 0, y: 0 },
    agentNode("agent", "codex"),
  ]);
  const { result } = renderHook(() => useDraft(plan));

  act(() => {
    const source = { kind: "flow", nodeId: "start" } as const;
    result.current.graph.connectFrom(source, "agent");
    result.current.graph.connectFrom(source, "agent");
  });

  expect(result.current.draft.edges).toHaveLength(1);
});
