import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  createMoveRequest,
  resolveDropZone,
  useWikiDrag,
} from "@/app/components/wiki/use-wiki-drag";

import type { WikiMoveRequest } from "@/app/components/wiki/use-wiki-drag";
import type { WikiTreeNode } from "@/definition/Wiki";

const nodes: WikiTreeNode[] = [
  {
    id: "a",
    parentId: null,
    title: "A",
    icon: null,
    scope: "instance",
    projectId: null,
    position: 0,
    currentUntil: null,
  },
  {
    id: "child",
    parentId: "a",
    title: "Child",
    icon: null,
    scope: "instance",
    projectId: null,
    position: 0,
    currentUntil: null,
  },
  {
    id: "b",
    parentId: null,
    title: "B",
    icon: null,
    scope: "instance",
    projectId: null,
    position: 1,
    currentUntil: null,
  },
  {
    id: "c",
    parentId: null,
    title: "C",
    icon: null,
    scope: "instance",
    projectId: null,
    position: 2,
    currentUntil: null,
  },
];
const [a, child, b, c] = nodes;
if (!a || !child || !b || !c) throw new Error("Missing fixture nodes");

it("resolves row quarters and constructs moves in sibling order", () => {
  expect([
    resolveDropZone(24, 100),
    resolveDropZone(25, 100),
    resolveDropZone(76, 100),
    resolveDropZone(0, 0),
  ]).toEqual(["before", "inside", "after", "inside"]);
  expect(
    createMoveRequest(nodes, { dragged: a, target: b, zone: "inside" }),
  ).toMatchObject({ parentId: "b", beforeId: null });
  expect(
    createMoveRequest(nodes, { dragged: a, target: b, zone: "before" }),
  ).toMatchObject({ parentId: null, beforeId: "b" });
  expect(
    createMoveRequest(nodes, { dragged: a, target: b, zone: "after" }),
  ).toMatchObject({ parentId: null, beforeId: "c" });
  expect(
    createMoveRequest(nodes, { dragged: c, target: b, zone: "after" }).beforeId,
  ).toBeNull();
});

function DragTree({
  onMove,
}: {
  readonly onMove: (request: WikiMoveRequest) => void;
}): React.ReactElement {
  const drag = useWikiDrag(nodes, onMove);
  return (
    <div>
      {nodes.map((node) => (
        <div
          key={node.id}
          draggable
          onDragStart={(event) => drag.onDragStart(event, node)}
          onDragOver={(event) => drag.onDragOver(event, node)}
          onDrop={(event) => drag.onDrop(event, node)}
          onDragEnd={drag.onDragEnd}
        >
          {node.title}
        </div>
      ))}
      <div
        onDragOver={drag.onAreaDragOver}
        onDrop={(event) =>
          drag.onAreaDrop(event, { scope: "private", projectId: null })
        }
      >
        Area
      </div>
      <output>{`${drag.dropTargetId ?? "none"}:${drag.dropZone ?? "none"}`}</output>
    </div>
  );
}

it("rejects descendants and moves a page to a row or an area", () => {
  const onMove = vi.fn();
  const setData = vi.fn();
  const transfer = { effectAllowed: "", setData };
  render(<DragTree onMove={onMove} />);
  const source = screen.getByText("A");
  const target = screen.getByText("B");
  fireEvent.dragStart(source, { dataTransfer: transfer });
  expect(setData).toHaveBeenCalledWith("text/plain", "a");
  fireEvent.dragOver(screen.getByText("Child"));
  expect(screen.getByText("none:none")).toBeTruthy();
  fireEvent.drop(screen.getByText("Child"));
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.dragStart(source, { dataTransfer: transfer });
  fireEvent.dragOver(target);
  expect(screen.getByText("b:inside")).toBeTruthy();
  fireEvent.drop(target);
  expect(onMove).toHaveBeenCalledWith(
    expect.objectContaining({ pageId: "a", parentId: "b" }),
  );
  expect(screen.getByText("none:none")).toBeTruthy();
  fireEvent.dragStart(target, { dataTransfer: transfer });
  fireEvent.dragOver(screen.getByText("Area"));
  fireEvent.drop(screen.getByText("Area"));
  expect(onMove).toHaveBeenLastCalledWith({
    pageId: "b",
    from: { scope: "instance", projectId: null },
    scope: "private",
    projectId: null,
    parentId: null,
    beforeId: null,
  });
  fireEvent.dragEnd(target);
});
