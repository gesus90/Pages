import { Position, ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanFlowContext } from "@/app/components/agents/plans/plan-flow-context";
import { PlanFlowEdgeView } from "@/app/components/agents/plans/plan-flow-edge";

import { flowContext, i18n } from "./plan-flow-fixture";

import type { EdgeProps, InternalNode, Node } from "@xyflow/react";
import type { PlanFlowEdge } from "@/app/components/agents/plans/plan-flow-model";

const cards = vi.hoisted(() => new Map<string, InternalNode | undefined>());

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useInternalNode: (id: string) => cards.get(id),
}));

afterEach(() => cards.clear());

/** What React Flow has measured of a card: its corner, and its height unless it is still unknown. */
function card(top: number, height?: number): InternalNode {
  const node: Node = { id: "card", position: { x: 0, y: top }, data: {} };
  return {
    ...node,
    measured: height === undefined ? {} : { width: 200, height },
    internals: {
      positionAbsolute: node.position,
      handleBounds: undefined,
      z: 0,
      userNode: node,
    },
  };
}

function props(
  overrides: Partial<EdgeProps<PlanFlowEdge>>,
): EdgeProps<PlanFlowEdge> {
  return {
    id: "edge",
    source: "a",
    target: "b",
    sourceX: 10,
    sourceY: 20,
    targetX: 300,
    targetY: 120,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    animated: false,
    selected: false,
    selectable: true,
    deletable: false,
    data: {
      link: { kind: "flow", from: "a", to: "b" },
      name: "A → B",
    },
    ...overrides,
  };
}

const RETURN_WIRE = {
  kind: "wire",
  channel: "event",
  from: "a",
  to: "b",
  fromPort: "text-out",
  toPort: "event-in",
} as const;

function drawnPath(edge: EdgeProps<PlanFlowEdge>): string {
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <ReactFlowProvider>
        <PlanFlowContext.Provider value={flowContext()}>
          <svg>
            <PlanFlowEdgeView {...edge} />
          </svg>
        </PlanFlowContext.Provider>
      </ReactFlowProvider>
    </I18nextProvider>,
  );
  const path = container.querySelector("path[id='edge']");
  if (!path) throw new Error("The edge was not drawn");
  return path.getAttribute("d") ?? "";
}

describe("a connection whose cards React Flow has not measured yet", () => {
  it("keeps the ends React Flow gave it", () => {
    expect(drawnPath(props({}))).toMatch(/^M10,20 C/);
  });

  it("runs a way back below the ends alone when the cards are unknown", () => {
    const path = drawnPath(
      props({
        sourceX: 500,
        sourceY: 20,
        targetX: 100,
        targetY: 20,
        data: { link: RETURN_WIRE, name: "A → B" },
      }),
    );

    // 20 is the lowest end; the line runs 40 below it.
    expect(path).toContain("Q536,60");
  });

  it("counts a card without a measured height as ending at its top edge", () => {
    cards.set("a", card(100));
    cards.set("b", card(30));

    const path = drawnPath(
      props({
        sourceX: 500,
        targetX: 100,
        targetY: 20,
        data: { link: RETURN_WIRE, name: "A → B" },
      }),
    );

    expect(path).toContain("Q536,140");
  });

  it("runs a way back below the measured height of the lower card", () => {
    cards.set("a", card(100, 50));
    cards.set("b", card(30, 20));

    const path = drawnPath(
      props({
        sourceX: 500,
        targetX: 100,
        targetY: 20,
        data: { link: RETURN_WIRE, name: "A → B" },
      }),
    );

    expect(path).toContain("Q536,190");
  });
});
