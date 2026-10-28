import { Handle, MarkerType, Position, ReactFlow } from "@xyflow/react";
import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanFlowContext } from "@/app/components/agents/plans/plan-flow-context";
import { PlanFlowEdgeView } from "@/app/components/agents/plans/plan-flow-edge";

import { flowContext, graphActions, i18n } from "./plan-flow-fixture";

import type { Edge, Node } from "@xyflow/react";
import type { PlanFlowEdge } from "@/app/components/agents/plans/plan-flow-model";
import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";

const EDGE_TYPES = { plan: PlanFlowEdgeView };
const FLOW_LINK = { kind: "flow", from: "a", to: "b" } as const;
const DATA_LINK = {
  kind: "data",
  from: "a",
  to: "b",
  parameter: "notes",
} as const;

/** A card with an IN and an OUT on its sides and one more port above and below. */
function Box(): React.ReactElement {
  return (
    <div>
      <Handle id="flow-in" type="target" position={Position.Left} />
      <Handle id="flow-out" type="source" position={Position.Right} />
      <Handle id="top" type="source" position={Position.Top} />
      <Handle id="bottom" type="target" position={Position.Bottom} />
    </div>
  );
}

const NODE_TYPES = { box: Box };

const NODES: Node[] = [
  { id: "a", type: "box", position: { x: 0, y: 0 }, data: {} },
  { id: "b", type: "box", position: { x: 400, y: 200 }, data: {} },
];

function edge(
  id: string,
  details: PlanFlowEdge["data"],
  overrides: Partial<Edge> = {},
): Edge {
  return {
    id,
    type: "plan",
    source: "a",
    sourceHandle: "flow-out",
    target: "b",
    targetHandle: "flow-in",
    data: details,
    markerEnd: { type: MarkerType.ArrowClosed },
    ...overrides,
  };
}

function renderEdges(
  edges: readonly Edge[],
  options: {
    readonly graph?: PlanGraphActions;
    readonly canEdit?: boolean;
  } = {},
): { readonly graph: PlanGraphActions; readonly container: HTMLElement } {
  const graph = options.graph ?? graphActions();
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <PlanFlowContext.Provider
        value={flowContext({ graph, canEdit: options.canEdit ?? true })}
      >
        <section tabIndex={-1} aria-label="Canvas">
          <div style={{ width: 800, height: 600 }}>
            <ReactFlow
              nodes={NODES}
              edges={[...edges]}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
            />
          </div>
        </section>
      </PlanFlowContext.Provider>
    </I18nextProvider>,
  );
  return { graph, container };
}

async function edgePath(id: string): Promise<Element> {
  return waitFor(() => {
    const path = document.getElementById(id);
    if (!path) throw new Error(`The edge ${id} is not drawn yet.`);
    return path;
  });
}

function label(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

function flowName(name: string): string {
  return `${i18n.t("plans.linkKind.flow")}: ${name}`;
}

function transformOf(element: HTMLElement): string {
  return element.parentElement?.style.transform ?? "";
}

it("draws a flow connection as a solid curve with a selectable label at its middle", async () => {
  const { graph } = renderEdges([
    edge("flow", { link: FLOW_LINK, name: "A → B" }),
  ]);
  const path = await edgePath("flow");

  expect(path.getAttribute("d")).toMatch(/^M[\d.]+,[\d.]+ C/);
  expect(path.getAttribute("style")).not.toContain("stroke-dasharray");
  const button = label(flowName("A → B"));
  expect(button.textContent).toBe(`→ ${i18n.t("plans.linkKind.flow")}`);
  expect(button.getAttribute("aria-pressed")).toBeNull();
  expect(transformOf(button)).toMatch(/^translate\(-50%, -50%\)/);
  fireEvent.click(button);

  expect(graph.selectLink).toHaveBeenCalledWith(FLOW_LINK);
  expect(
    screen.queryByRole("button", {
      name: i18n.t("plans.removeLinkAtSource", { name: "A → B" }),
    }),
  ).toBeNull();
});

it("draws a value binding dashed and names its input", async () => {
  renderEdges([edge("data", { link: DATA_LINK, name: "A → B · notes" })]);
  const path = await edgePath("data");

  expect(path.getAttribute("style")).toContain("stroke-dasharray: 6 5");
  const button = label(`${i18n.t("plans.linkKind.data")}: A → B · notes`);
  expect(button.textContent).toBe("◇ notes");
  expect(button.classList).toContain("border-dashed");
});

it("starts the line of a collapsed source group at its route label", async () => {
  renderEdges([
    edge("from", {
      link: FLOW_LINK,
      name: "Group → B",
      routeEnd: "from",
      routeLabelOffsetY: 12,
    }),
  ]);
  const path = await edgePath("from");

  expect(path.getAttribute("d")).toMatch(/^M[\d.]+,[\d.]+L[\d.]+,[\d.]+ C/);
  const button = label(flowName("Group → B"));
  expect(button.textContent).toBe("→ Group → B");
  expect(transformOf(button)).toMatch(/^translate\(0, -50%\)/);
});

it("ends the line of a collapsed target group at its route label", async () => {
  renderEdges([
    edge("to", { link: FLOW_LINK, name: "A → Group", routeEnd: "to" }),
  ]);
  const path = await edgePath("to");

  expect(path.getAttribute("d")).toMatch(/C.*L[\d.]+,[\d.]+$/);
  expect(transformOf(label(flowName("A → Group")))).toMatch(
    /^translate\(-100%, -50%\)/,
  );
});

it("draws a loop boundary line without a label", async () => {
  const { container } = renderEdges([
    edge("boundary", { link: FLOW_LINK, name: "", isBoundary: true }),
  ]);
  const path = await edgePath("boundary");

  expect(path.getAttribute("style")).toContain("stroke-width: 1.75");
  expect(
    container.querySelector(".react-flow__edgelabel-renderer button"),
  ).toBeNull();
});

it("draws nothing for a connection without plan details", async () => {
  const { container } = renderEdges([
    edge("bare", undefined),
    edge("flow", { link: FLOW_LINK, name: "A → B" }),
  ]);
  await edgePath("flow");

  expect(
    container.querySelector('.react-flow__edge[data-id="bare"]'),
  ).not.toBeNull();
  expect(document.getElementById("bare")).toBeNull();
});

it("offers a selected connection's removal at both ends and removes it once", async () => {
  const { graph } = renderEdges([
    edge("flow", { link: FLOW_LINK, name: "A → B" }, { selected: true }),
  ]);
  const path = await edgePath("flow");
  const source = label(i18n.t("plans.removeLinkAtSource", { name: "A → B" }));
  const target = label(i18n.t("plans.removeLinkAtTarget", { name: "A → B" }));

  expect(path.getAttribute("style")).toContain("stroke-width: 2.5");
  expect(label(flowName("A → B")).getAttribute("aria-pressed")).toBe("true");
  expect(source.style.transform).not.toBe(target.style.transform);
  fireEvent.click(source);
  fireEvent.click(target);

  expect(graph.disconnect).toHaveBeenCalledOnce();
  expect(graph.disconnect).toHaveBeenCalledWith(FLOW_LINK);
  expect(document.activeElement).toBe(
    screen.getByRole("region", { name: "Canvas" }),
  );
});

it("places the removal of a connection between top and bottom ports beside them", async () => {
  renderEdges([
    edge(
      "vertical",
      { link: FLOW_LINK, name: "A → B" },
      { selected: true, sourceHandle: "top", targetHandle: "bottom" },
    ),
  ]);
  await edgePath("vertical");

  const source = label(i18n.t("plans.removeLinkAtSource", { name: "A → B" }));
  const target = label(i18n.t("plans.removeLinkAtTarget", { name: "A → B" }));
  expect(source.style.transform).toMatch(/translate\([-\d.]+px, -?[\d.]+px\)$/);
  expect(source.style.transform).not.toBe(target.style.transform);
});

it("keeps pointer and double clicks of a removal button away from the canvas", async () => {
  const onPointerDown = vi.fn();
  const onDoubleClick = vi.fn();
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("dblclick", onDoubleClick);
  renderEdges([
    edge("flow", { link: FLOW_LINK, name: "A → B" }, { selected: true }),
  ]);
  await edgePath("flow");
  const source = label(i18n.t("plans.removeLinkAtSource", { name: "A → B" }));

  fireEvent.pointerDown(source);
  fireEvent.doubleClick(source);
  fireEvent.keyDown(source, { key: "Delete" });
  fireEvent.pointerDown(label(flowName("A → B")));

  expect(onPointerDown).toHaveBeenCalledOnce();
  expect(onDoubleClick).not.toHaveBeenCalled();
  document.removeEventListener("pointerdown", onPointerDown);
  document.removeEventListener("dblclick", onDoubleClick);
});

it("offers no removal on a read-only canvas", async () => {
  renderEdges(
    [edge("flow", { link: FLOW_LINK, name: "A → B" }, { selected: true })],
    { canEdit: false },
  );
  await edgePath("flow");

  expect(label(flowName("A → B")).getAttribute("aria-pressed")).toBe("true");
  expect(
    screen.queryByRole("button", {
      name: i18n.t("plans.removeLinkAtSource", { name: "A → B" }),
    }),
  ).toBeNull();
});
