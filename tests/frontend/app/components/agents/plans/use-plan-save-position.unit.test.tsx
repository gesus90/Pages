import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { expect, it } from "vitest";

import { usePlanFlowMovement } from "@/app/components/agents/plans/use-plan-flow-movement";

import {
  actionScene,
  planPage,
  planView,
  renderWithEditor,
} from "./plan-panel-fixture";

import type { PlanEditor } from "./plan-panel-fixture";

const EXPANDED = new Set<string>();

function SaveDuringDrag({
  editor,
  cancelBeforeSave = false,
}: {
  readonly editor: PlanEditor;
  readonly cancelBeforeSave?: boolean;
}): React.ReactElement {
  const movement = usePlanFlowMovement({
    draft: editor.draft,
    sources: editor.sources,
    graph: editor.graph,
    canEdit: editor.canEdit,
    collapsedGroups: EXPANDED,
  });
  return (
    <button
      type="button"
      onClick={() => {
        const node = movement.nodes.find((entry) => entry.id === "start");
        if (!node) throw new Error("Synthetic start node is missing");
        movement.onNodeDragStart(new MouseEvent("mousedown"), node, [node]);
        movement.onNodesChange([
          {
            type: "position",
            id: node.id,
            position: { x: 197, y: 243 },
            dragging: true,
          },
        ]);
        if (cancelBeforeSave) movement.cancel();
        editor.save();
      }}
    >
      Save during drag
    </button>
  );
}

it("saves the latest position when a move and save are queued together", async () => {
  const selected = planView({
    nodes: [{ id: "start", type: "start", x: 100, y: 100 }],
  });
  const scene = actionScene();
  renderWithEditor(planPage({ selected }), scene, (editor) => (
    <button
      type="button"
      onClick={() => {
        editor.graph.move("start", 197, 243);
        editor.save();
      }}
    >
      Move and save
    </button>
  ));

  fireEvent.click(screen.getByRole("button", { name: "Move and save" }));

  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  const saved: unknown = JSON.parse(String(scene.submissions[0].get("plan")));
  expect(saved).toMatchObject({
    nodes: [{ id: "start", x: 197, y: 243 }],
  });
});

it("saves the last of several queued moves together with the requested edit", async () => {
  const selected = planView({
    nodes: [{ id: "start", type: "start", x: 100, y: 100 }],
  });
  const scene = actionScene();
  renderWithEditor(planPage({ selected }), scene, (editor) => (
    <button
      type="button"
      onClick={() => {
        editor.graph.move("start", 197, 243);
        editor.graph.move("start", 317, 259);
        editor.saveWith((draft) => ({ ...draft, name: "Renamed" }));
      }}
    >
      Move twice and save
    </button>
  ));

  fireEvent.click(screen.getByRole("button", { name: "Move twice and save" }));

  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  const saved: unknown = JSON.parse(String(scene.submissions[0].get("plan")));
  expect(saved).toMatchObject({
    name: "Renamed",
    nodes: [{ id: "start", x: 317, y: 259 }],
  });
});

it("saves the visible position while a drag is still in progress", async () => {
  const selected = planView({
    nodes: [{ id: "start", type: "start", x: 100, y: 100 }],
  });
  const scene = actionScene();
  renderWithEditor(planPage({ selected }), scene, (editor) => (
    <ReactFlowProvider>
      <SaveDuringDrag editor={editor} />
    </ReactFlowProvider>
  ));

  fireEvent.click(screen.getByRole("button", { name: "Save during drag" }));

  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  const saved: unknown = JSON.parse(String(scene.submissions[0].get("plan")));
  expect(saved).toMatchObject({ nodes: [{ id: "start", x: 197, y: 243 }] });
});

it("does not save a visual move cancelled before the save", async () => {
  const selected = planView({
    nodes: [{ id: "start", type: "start", x: 100, y: 100 }],
  });
  const scene = actionScene();
  renderWithEditor(planPage({ selected }), scene, (editor) => (
    <ReactFlowProvider>
      <SaveDuringDrag editor={editor} cancelBeforeSave />
    </ReactFlowProvider>
  ));

  fireEvent.click(screen.getByRole("button", { name: "Save during drag" }));

  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  const saved: unknown = JSON.parse(String(scene.submissions[0].get("plan")));
  expect(saved).toMatchObject({ nodes: [{ id: "start", x: 100, y: 100 }] });
});
