import { ConnectionLineType, Position } from "@xyflow/react";
import { expect, it } from "vitest";

import { PlanFlowConnectionLine } from "@/app/components/agents/plans/plan-flow-connection-line";

import { flowContext, graphActions, renderInFlow } from "./plan-flow-fixture";

import type {
  ConnectionLineComponentProps,
  InternalNode,
  Node,
} from "@xyflow/react";
import type { PlanConnection } from "@/app/components/agents/plans/use-plan-connections";

const START: Node = { id: "start", position: { x: 0, y: 0 }, data: {} };
const START_INTERNAL: InternalNode = {
  ...START,
  measured: { width: 200, height: 100 },
  internals: { positionAbsolute: { x: 0, y: 0 }, z: 0, userNode: START },
};

function lineProps(
  connectionStatus: ConnectionLineComponentProps["connectionStatus"],
): ConnectionLineComponentProps {
  return {
    connectionLineType: ConnectionLineType.Bezier,
    fromNode: START_INTERNAL,
    fromHandle: {
      id: "flow-out",
      nodeId: "start",
      x: 0,
      y: 0,
      position: Position.Right,
      type: "source",
      width: 8,
      height: 8,
    },
    fromX: 10,
    fromY: 20,
    toX: 110,
    toY: 60,
    fromPosition: Position.Right,
    toPosition: Position.Left,
    connectionStatus,
    toNode: null,
    toHandle: null,
    pointer: { x: 110, y: 60 },
  };
}

function renderLine(
  connection: PlanConnection | null,
  connectionStatus: ConnectionLineComponentProps["connectionStatus"] = null,
): HTMLElement {
  const { container } = renderInFlow(
    <svg>
      <PlanFlowConnectionLine {...lineProps(connectionStatus)} />
    </svg>,
    flowContext({ graph: graphActions({ connection }) }),
  );
  return container;
}

function element(container: HTMLElement, selector: string): Element {
  const found = container.querySelector(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

it("draws nothing while no plan connection is open", () => {
  const container = renderLine(null);

  expect(container.querySelector("g")).toBeNull();
});

it("previews a flow connection as a solid curve that ends in a dot at the pointer", () => {
  const container = renderLine({ kind: "flow", nodeId: "start" }, "valid");
  const path = element(container, "path");
  const dot = element(container, "circle");

  expect(path.getAttribute("d")).toMatch(/^M10,20 C/);
  expect(path.hasAttribute("stroke-dasharray")).toBe(false);
  expect(dot.getAttribute("cx")).toBe("110");
  expect(dot.getAttribute("cy")).toBe("60");
  expect(dot.getAttribute("stroke")).toBe("var(--color-muted-foreground)");
});

it("previews a value binding dashed and marks a refused end", () => {
  const container = renderLine({ kind: "result", nodeId: "start" }, "invalid");

  expect(element(container, "path").getAttribute("stroke-dasharray")).toBe(
    "6 5",
  );
  expect(element(container, "circle").getAttribute("stroke")).toBe(
    "var(--color-destructive)",
  );
});
