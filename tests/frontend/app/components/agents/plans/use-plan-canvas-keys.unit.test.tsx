import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { usePlanCanvasKeys } from "@/app/components/agents/plans/use-plan-canvas-keys";

import { graphActions } from "./plan-flow-fixture";

import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";

const LINK = { kind: "flow", from: "a", to: "b" } as const;

function Grid(props: {
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly onCancel: () => void;
}): React.ReactElement {
  const onKeyDown = usePlanCanvasKeys(props);
  return (
    <div
      role="application"
      aria-label="Grid"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <input aria-label="Field" />
      <button type="button" data-plan-handle="a">
        Handle a
      </button>
      <button type="button" data-plan-handle="b">
        Handle b
      </button>
      <div className="react-flow__pane" data-testid="pane" />
      <svg>
        <g className="react-flow__edge" data-testid="edge" />
        <g data-testid="drawing" />
      </svg>
    </div>
  );
}

function show(
  graph: PlanGraphActions,
  canEdit = true,
): { readonly onCancel: ReturnType<typeof vi.fn> } {
  const onCancel = vi.fn();
  render(<Grid graph={graph} canEdit={canEdit} onCancel={onCancel} />);
  return { onCancel };
}

function grid(): HTMLElement {
  return screen.getByRole("application", { name: "Grid" });
}

it("ends a drag and an open connection with Escape", () => {
  const graph = graphActions();
  const { onCancel } = show(graph);
  fireEvent.keyDown(screen.getByLabelText("Field"), { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();
  expect(graph.begin).toHaveBeenCalledWith(null);
});

it("removes the selected node from the grid or its own handle", () => {
  const graph = graphActions({ selectedId: "a" });
  show(graph);
  expect(fireEvent.keyDown(grid(), { key: "Delete" })).toBe(false);
  fireEvent.keyDown(screen.getByRole("button", { name: "Handle a" }), {
    key: "Backspace",
  });
  expect(graph.remove).toHaveBeenCalledTimes(2);
  expect(graph.remove).toHaveBeenCalledWith("a");
});

it("disconnects a selected connection from the pane or an edge", () => {
  const graph = graphActions({ selectedLink: LINK });
  show(graph);
  fireEvent.keyDown(screen.getByTestId("pane"), { key: "Delete" });
  fireEvent.keyDown(screen.getByTestId("edge"), { key: "Delete" });
  expect(graph.disconnect).toHaveBeenCalledTimes(2);
  expect(graph.disconnect).toHaveBeenCalledWith(LINK);
  expect(graph.remove).not.toHaveBeenCalled();
});

it("keeps Delete for fields, other handles and drawings", () => {
  const graph = graphActions({ selectedId: "a" });
  show(graph);
  for (const target of [
    screen.getByLabelText("Field"),
    screen.getByRole("button", { name: "Handle b" }),
    screen.getByTestId("drawing"),
  ])
    expect(fireEvent.keyDown(target, { key: "Delete" })).toBe(true);
  expect(graph.remove).not.toHaveBeenCalled();
});

it("ignores handles while nothing is selected", () => {
  const graph = graphActions();
  show(graph);
  fireEvent.keyDown(screen.getByRole("button", { name: "Handle a" }), {
    key: "Delete",
  });
  expect(fireEvent.keyDown(grid(), { key: "Delete" })).toBe(true);
  expect(graph.remove).not.toHaveBeenCalled();
  expect(graph.disconnect).not.toHaveBeenCalled();
});

it("deletes nothing in a read-only plan", () => {
  const graph = graphActions({ selectedId: "a" });
  show(graph, false);
  fireEvent.keyDown(grid(), { key: "Delete" });
  expect(graph.remove).not.toHaveBeenCalled();
});

it("leaves other keys to the grid", () => {
  const graph = graphActions({ selectedId: "a" });
  show(graph);
  expect(fireEvent.keyDown(grid(), { key: "Enter" })).toBe(true);
  expect(graph.remove).not.toHaveBeenCalled();
});
