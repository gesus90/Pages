import { ReactFlowProvider } from "@xyflow/react";
import { expect, it, vi } from "vitest";

import { PlanFlowContext } from "@/app/components/agents/plans/plan-flow-context";
import { PlanGroupRoutes } from "@/app/components/agents/plans/plan-group-routes";

import {
  agentNode,
  flowContext,
  flowEdge,
  planOf,
  renderTranslated,
  sessionGroup,
} from "./plan-group-fixture";

import type * as ReactFlowModule from "@xyflow/react";
import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

// React Flow measures nothing in jsdom; the spy records which node is asked to measure again.
const updateNodeInternals = vi.hoisted(() => vi.fn());
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactFlowModule>()),
  useUpdateNodeInternals: (): typeof updateNodeInternals => updateNodeInternals,
}));

const GROUP = sessionGroup({
  name: "Team",
  steps: [agentNode("m1", "codex"), agentNode("m2", "claude")],
  edges: [flowEdge("m1", "m2")],
});

/** Two links enter the group and one leaves it; a member also reads the ticket. */
function routedPlan(group: AgentPlanGroup = GROUP): AgentPlanInput {
  const members = group.steps.map((step) =>
    step.id === "m2"
      ? {
          ...step,
          bindings: { notes: { kind: "source" as const, nodeId: "ticket" } },
        }
      : step,
  );
  return planOf(
    [
      { id: "start", type: "start", x: 0, y: 0 },
      { id: "ticket", type: "task", x: 0, y: 0, taskId: "task-1" },
      { ...group, steps: members },
      { id: "end", type: "end", x: 0, y: 0 },
    ],
    [flowEdge("start", "m1"), flowEdge("m2", "end"), flowEdge("start", "end")],
  );
}

function Routes(props: {
  readonly draft: AgentPlanInput;
  readonly isCollapsed: boolean;
}): React.ReactElement {
  return (
    <ReactFlowProvider>
      <PlanFlowContext value={flowContext(props.draft)}>
        <PlanGroupRoutes group={GROUP} isCollapsed={props.isCollapsed} />
      </PlanFlowContext>
    </ReactFlowProvider>
  );
}

function anchors(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".react-flow__handle")];
}

it("adds no anchors while the group is expanded", () => {
  const { container } = renderTranslated(
    <Routes draft={routedPlan()} isCollapsed={false} />,
  );
  expect(anchors(container)).toHaveLength(0);
  expect(updateNodeInternals).toHaveBeenLastCalledWith("group");
});

it("keeps one silent anchor per crossing link on the collapsed frame's sides", () => {
  const { container } = renderTranslated(
    <Routes draft={routedPlan()} isCollapsed />,
  );
  const shown = anchors(container).map((anchor) => ({
    id: anchor.dataset.handleid,
    side: anchor.dataset.handlepos,
    isTarget: anchor.classList.contains("target"),
    isConnectable: anchor.classList.contains("connectable"),
    title: anchor.title,
    top: anchor.style.top,
  }));
  expect(shown).toEqual([
    {
      id: "route:flow:start:m1:to",
      side: "left",
      isTarget: true,
      isConnectable: false,
      title: "start → Codex One",
      top: "33.333333333333336%",
    },
    {
      id: "route:flow:m2:end:from",
      side: "right",
      isTarget: false,
      isConnectable: false,
      title: "Claude → end",
      top: "50%",
    },
    {
      id: "route:data:m2:notes:to",
      side: "left",
      isTarget: true,
      isConnectable: false,
      title: "SYN-1: Open work → Claude · notes",
      top: "66.66666666666667%",
    },
  ]);
  for (const anchor of anchors(container))
    expect(anchor.getAttribute("aria-hidden")).toBe("true");
});

it("measures the frame again when it collapses or its crossing links change", () => {
  const { rerender } = renderTranslated(
    <Routes draft={routedPlan()} isCollapsed={false} />,
  );
  const calls = updateNodeInternals.mock.calls.length;
  rerender(<Routes draft={routedPlan()} isCollapsed={false} />);
  expect(updateNodeInternals.mock.calls.length).toBe(calls);
  rerender(<Routes draft={routedPlan()} isCollapsed />);
  expect(updateNodeInternals.mock.calls.length).toBe(calls + 1);
  const fewer = { ...routedPlan(), edges: [flowEdge("start", "m1")] };
  rerender(<Routes draft={fewer} isCollapsed />);
  expect(updateNodeInternals.mock.calls.length).toBe(calls + 2);
  expect(updateNodeInternals).toHaveBeenLastCalledWith("group");
});
