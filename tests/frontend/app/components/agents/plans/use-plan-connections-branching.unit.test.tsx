import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";

import { planConditionRefusal } from "@/app/components/agents/plans/use-plan-connections";
import { usePlanGraph } from "@/app/components/agents/plans/use-plan-graph";

import {
  DECISION,
  branchEdge,
  conditionEdge,
  eventEdge,
  reviewCyclePlan,
} from "./plan-branching-fixture";
import {
  GROUP_SOURCES,
  agentNode,
  flowEdge,
  planOf,
} from "./plan-group-fixture";

import type { AgentPlanInput } from "@/definition/AgentPlan";

function useDraft(initial: AgentPlanInput): {
  readonly draft: AgentPlanInput;
  readonly graph: ReturnType<typeof usePlanGraph>;
} {
  const [draft, setDraft] = useState(initial);
  return { draft, graph: usePlanGraph(draft, setDraft, GROUP_SOURCES) };
}

/** Start → check → fix → End, and an undecided decision beside them. */
function chainPlan(): AgentPlanInput {
  return planOf(
    [
      { id: "start", type: "start", x: 0, y: 0 },
      agentNode("check", "codex"),
      agentNode("fix", "codex-two"),
      { ...DECISION },
      { id: "end", type: "end", x: 900, y: 0 },
    ],
    [
      flowEdge("start", "check"),
      flowEdge("check", "fix"),
      flowEdge("fix", "end"),
    ],
  );
}

it("connects the boolean result of an agent to the condition of a decision", () => {
  const { result } = renderHook(() => useDraft(chainPlan()));
  const source = { kind: "passed", nodeId: "check" } as const;

  expect(
    result.current.graph.canConnectFrom(source, "decision", "condition-in"),
  ).toBe(true);
  act(() => {
    result.current.graph.connectFrom(source, "decision", "condition-in");
  });

  expect(result.current.draft.edges).toContainEqual(
    conditionEdge("check", "decision"),
  );
  expect(result.current.graph.connectionIssue).toBeNull();
});

it("refuses a second condition and names the reason", () => {
  const plan = {
    ...chainPlan(),
    edges: [...chainPlan().edges, conditionEdge("check", "decision")],
  };
  const { result } = renderHook(() => useDraft(plan));
  const source = { kind: "passed", nodeId: "fix" } as const;

  expect(
    result.current.graph.canConnectFrom(source, "decision", "condition-in"),
  ).toBe(false);
  act(() => {
    result.current.graph.connectFrom(source, "decision", "condition-in");
  });

  expect(result.current.draft.edges).toEqual(plan.edges);
  expect(result.current.graph.connectionIssue).toMatchObject({
    nodeId: "decision",
    reason: "duplicate",
  });
});

it("connects both outputs of a decision to flow inputs", () => {
  const { result } = renderHook(() => useDraft(chainPlan()));

  act(() => {
    result.current.graph.connectFrom(
      { kind: "branch", nodeId: "decision", branch: "true" },
      "end",
    );
    result.current.graph.connectFrom(
      { kind: "branch", nodeId: "decision", branch: "false" },
      "fix",
    );
  });

  expect(result.current.draft.edges).toEqual(
    expect.arrayContaining([
      branchEdge("decision", "true", "end"),
      branchEdge("decision", "false", "fix"),
    ]),
  );
});

it("returns the text result of a later agent to the event input of an earlier one", () => {
  const { result } = renderHook(() => useDraft(chainPlan()));
  const source = { kind: "result", nodeId: "fix" } as const;

  act(() => {
    result.current.graph.connectFrom(source, "check", "event-in");
  });

  expect(result.current.draft.edges).toContainEqual(eventEdge("fix", "check"));
});

it("refuses an event that would arrive before the first start of its target", () => {
  const chain = chainPlan();
  const plan = {
    ...chain,
    nodes: [...chain.nodes, agentNode("last", "claude")],
    edges: [...chain.edges, flowEdge("fix", "last")],
  };
  const { result } = renderHook(() => useDraft(plan));
  const source = { kind: "result", nodeId: "check" } as const;

  expect(result.current.graph.canConnectFrom(source, "last", "event-in")).toBe(
    false,
  );
  act(() => {
    result.current.graph.connectFrom(source, "last", "event-in");
  });

  expect(result.current.draft.edges).toEqual(plan.edges);
  expect(result.current.graph.connectionIssue).toMatchObject({
    nodeId: "last",
    reason: "eventOrder",
  });
});

it("refuses a source that does not fit the input and says so", () => {
  const { result } = renderHook(() => useDraft(chainPlan()));
  const { graph } = result.current;

  expect(graph.canConnectFrom({ kind: "passed", nodeId: "check" }, "end")).toBe(
    false,
  );
  expect(
    graph.canConnectFrom(
      { kind: "flow", nodeId: "check" },
      "decision",
      "condition-in",
    ),
  ).toBe(false);
  expect(
    graph.canConnectFrom(
      { kind: "source", nodeId: "check" },
      "check",
      "event-in",
    ),
  ).toBe(false);
  expect(
    graph.canConnectFrom(
      { kind: "branch", nodeId: "decision", branch: "true" },
      "check",
      "input1",
    ),
  ).toBe(false);
  act(() => {
    graph.connectFrom({ kind: "passed", nodeId: "check" }, "end");
  });
  expect(result.current.graph.connectionIssue).toMatchObject({
    nodeId: "end",
    port: "flow-in",
    reason: "type",
  });
});

it("is not blocked by a finding the draft already had", () => {
  // The way back of this event was cut, so the draft already has an eventOrder finding.
  const plan = planOf(
    [
      { id: "start", type: "start", x: 0, y: 0 },
      agentNode("check", "codex"),
      agentNode("fix", "codex-two"),
      { id: "end", type: "end", x: 900, y: 0 },
    ],
    [flowEdge("start", "check"), eventEdge("fix", "check")],
  );
  const { result } = renderHook(() => useDraft(plan));

  act(() => {
    result.current.graph.connectFrom({ kind: "flow", nodeId: "check" }, "fix");
  });

  expect(result.current.draft.edges).toContainEqual(flowEdge("check", "fix"));
  expect(result.current.graph.connectionIssue).toBeNull();
});

it("leaves a connection whose own result is a new finding refused", () => {
  const plan = reviewCyclePlan();
  const { result } = renderHook(() => useDraft(plan));

  act(() => {
    result.current.graph.connectFrom(
      { kind: "flow", nodeId: "start" },
      "check",
    );
  });

  expect(result.current.graph.connectionIssue).toMatchObject({
    reason: "duplicate",
  });
});

it("sets and clears the condition of a decision through the graph", () => {
  const { result } = renderHook(() => useDraft(reviewCyclePlan()));

  act(() => {
    result.current.graph.setDecisionCondition("decision", "fix");
  });
  expect(
    result.current.draft.edges.filter((edge) => edge.toPort === "condition-in"),
  ).toEqual([conditionEdge("fix", "decision")]);

  act(() => {
    result.current.graph.setDecisionCondition("decision", null);
  });
  expect(
    result.current.draft.edges.some((edge) => edge.toPort === "condition-in"),
  ).toBe(false);
});

it("removes every connection of a deleted decision or agent", () => {
  const { result } = renderHook(() => useDraft(reviewCyclePlan()));

  act(() => {
    result.current.graph.remove("decision");
  });
  expect(result.current.draft.edges).toEqual([
    flowEdge("start", "check"),
    eventEdge("fix", "check"),
  ]);

  act(() => {
    result.current.graph.remove("check");
  });
  expect(result.current.draft.edges).toEqual([]);
});

it("refuses an agent behind the decision as its condition, like a line would", () => {
  const draft = reviewCyclePlan();

  expect(planConditionRefusal(draft, GROUP_SOURCES, "decision", "fix")).toEqual(
    expect.objectContaining({ reason: "cycle" }),
  );
});

it("refuses nothing that keeps the plan as it is or clears the condition", () => {
  const draft = reviewCyclePlan();

  expect(
    planConditionRefusal(draft, GROUP_SOURCES, "decision", "check"),
  ).toBeNull();
  expect(
    planConditionRefusal(draft, GROUP_SOURCES, "decision", null),
  ).toBeNull();
  expect(
    planConditionRefusal(chainPlan(), GROUP_SOURCES, "decision", "check"),
  ).toBeNull();
});
