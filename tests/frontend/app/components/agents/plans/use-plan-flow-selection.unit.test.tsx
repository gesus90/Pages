import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { planLinkKey } from "@/app/components/agents/plans/plan-links";
import { usePlanFlowSelection } from "@/app/components/agents/plans/use-plan-flow-selection";

import {
  agentStep,
  flow,
  flowContext,
  graphActions,
  groupNode,
  loopNode,
  planOf,
  scriptStep,
} from "./plan-flow-fixture";
import { parameterNode } from "./plan-templates/template-fixture";

import type { PlanCanvasProps } from "@/app/components/agents/plans/plan-flow-context";
import type {
  PlanFlowEdge,
  PlanFlowNode,
} from "@/app/components/agents/plans/plan-flow-model";
import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { Mock } from "vitest";

const LINK = { kind: "flow", from: "agent", to: "script" } as const;
const NODES: readonly AgentPlanNode[] = [
  agentStep("agent"),
  groupNode("group", []),
  scriptStep("script", 1),
  loopNode("loop", []),
  parameterNode(),
];

function flowNode(node: AgentPlanNode): PlanFlowNode {
  return {
    id: node.id,
    type: "plan",
    position: { x: 0, y: 0 },
    data: { node },
  };
}

function flowEdge(withLink: boolean): PlanFlowEdge {
  return {
    id: planLinkKey(LINK),
    source: LINK.from,
    target: LINK.to,
    ...(withLink ? { data: { link: LINK, name: "" } } : {}),
  };
}

function Grid(props: { readonly canvas: PlanCanvasProps }): React.ReactElement {
  const selection = usePlanFlowSelection(props.canvas);
  return (
    <>
      {NODES.map((node) => (
        <div
          key={node.id}
          data-testid={node.id}
          onClick={(event) => selection.onNodeClick?.(event, flowNode(node))}
          onDoubleClick={(event) =>
            selection.onNodeDoubleClick?.(event, flowNode(node))
          }
        >
          <button type="button">Menu {node.id}</button>
          <button type="button" data-plan-handle={node.id}>
            Handle {node.id}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={(event) => selection.onEdgeClick?.(event, flowEdge(true))}
      >
        Edge
      </button>
      <button
        type="button"
        onClick={(event) => selection.onEdgeClick?.(event, flowEdge(false))}
      >
        Bare edge
      </button>
      <button type="button" onClick={(event) => selection.onPaneClick?.(event)}>
        Pane
      </button>
    </>
  );
}

function show(): PlanCanvasProps & {
  readonly onOpen: Mock<(id: string) => void>;
  readonly onEdit: Mock<(id: string) => void>;
} {
  const onOpen = vi.fn<(id: string) => void>();
  const onEdit = vi.fn<(id: string) => void>();
  const canvas = flowContext({
    draft: planOf(NODES, [flow("agent", "script")]),
    graph: graphActions(),
    onOpen,
    onEdit,
  });
  render(<Grid canvas={canvas} />);
  return { ...canvas, onOpen, onEdit };
}

it("selects a node on click and clears the selection on the pane", () => {
  const { graph } = show();
  fireEvent.click(screen.getByTestId("agent"));
  expect(graph.select).toHaveBeenCalledWith("agent");
  fireEvent.click(screen.getByRole("button", { name: "Pane" }));
  expect(graph.select).toHaveBeenLastCalledWith(null);
});

it("opens agents and groups and edits scripts and loops on double-click", () => {
  const { graph, onOpen, onEdit } = show();
  for (const id of ["agent", "group", "script", "loop", "parameter"])
    fireEvent.doubleClick(screen.getByTestId(id));
  expect(graph.select).toHaveBeenCalledTimes(5);
  expect(onOpen.mock.calls).toEqual([["agent"], ["group"]]);
  expect(onEdit.mock.calls).toEqual([["script"], ["loop"]]);
});

it("ignores double-clicks on controls inside a node but not on its handle", () => {
  const { graph, onOpen } = show();
  fireEvent.doubleClick(screen.getByRole("button", { name: "Menu agent" }));
  expect(graph.select).not.toHaveBeenCalled();
  fireEvent.doubleClick(screen.getByRole("button", { name: "Handle agent" }));
  expect(graph.select).toHaveBeenCalledWith("agent");
  expect(onOpen).toHaveBeenCalledWith("agent");
});

it("selects a clicked connection, or nothing for an edge without a link", () => {
  const { graph } = show();
  fireEvent.click(screen.getByRole("button", { name: "Edge" }));
  expect(graph.selectLink).toHaveBeenCalledWith(LINK);
  fireEvent.click(screen.getByRole("button", { name: "Bare edge" }));
  expect(graph.selectLink).toHaveBeenLastCalledWith(null);
});

it("follows the keyboard selection of a connection", () => {
  const canvas = flowContext({
    draft: planOf(NODES, [flow("agent", "script")]),
    graph: graphActions(),
  });
  const changes = renderHook(() => usePlanFlowSelection(canvas)).result.current
    .onEdgesChange;
  if (!changes) throw new Error("Expected the edge change handler");
  changes([{ type: "remove", id: "x" }]);
  changes([{ type: "select", id: planLinkKey(LINK), selected: false }]);
  expect(canvas.graph.selectLink).not.toHaveBeenCalled();
  changes([{ type: "select", id: planLinkKey(LINK), selected: true }]);
  expect(canvas.graph.selectLink).toHaveBeenCalledWith(LINK);
  changes([{ type: "select", id: "flow:gone:away", selected: true }]);
  expect(canvas.graph.selectLink).toHaveBeenLastCalledWith(null);
});
