import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  ChatPageDropZone,
  useFileDrop,
  usePageFileDrop,
} from "@/app/components/chat-page/chat-page-drop-zone";

function DropTarget({
  onFiles,
}: {
  onFiles: (files: File[]) => void;
}): React.ReactElement {
  const drop = useFileDrop(onFiles);
  const pageDragging = usePageFileDrop(onFiles);
  return (
    <div data-testid="inner" {...drop.handlers}>
      {drop.isDragging ? "inner dragging" : "inner idle"}
      {pageDragging ? " page dragging" : " page idle"}
    </div>
  );
}

it("tracks nested drags and delivers a bubbling drop only once", () => {
  const onFiles = vi.fn();
  render(
    <ChatPageDropZone data-testid="zone">
      <DropTarget onFiles={onFiles} />
    </ChatPageDropZone>,
  );
  const inner = screen.getByTestId("inner");
  const file = new File(["hello"], "note.txt");
  const transfer = { types: ["Files"], files: [file], dropEffect: "none" };
  fireEvent.dragEnter(inner, { dataTransfer: transfer });
  fireEvent.dragEnter(inner, { dataTransfer: transfer });
  expect(inner.textContent).toBe("inner dragging page dragging");
  fireEvent.dragLeave(inner, { dataTransfer: transfer });
  expect(inner.textContent).toBe("inner dragging page dragging");
  fireEvent.dragOver(inner, { dataTransfer: transfer });
  expect(transfer.dropEffect).toBe("copy");
  fireEvent.drop(inner, { dataTransfer: transfer });
  expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]);
  expect(inner.textContent).toBe("inner idle page idle");
});

it("forwards a page drop and ignores text drags", () => {
  const onFiles = vi.fn();
  render(
    <ChatPageDropZone data-testid="zone">
      <DropTarget onFiles={onFiles} />
    </ChatPageDropZone>,
  );
  const zone = screen.getByTestId("zone");
  fireEvent.dragEnter(zone, { dataTransfer: { types: ["text/plain"] } });
  expect(screen.getByTestId("inner").textContent).toBe("inner idle page idle");
  const file = new File(["x"], "page.txt");
  fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [file] } });
  expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]);
});
