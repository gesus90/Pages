import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useChatDropzone } from "@/app/components/chat/use-chat-dropzone";

function DropTarget({
  canDrop,
  isOpen,
  onFiles,
}: {
  canDrop: boolean;
  isOpen: boolean;
  onFiles: (files: readonly File[], folders: readonly string[]) => void;
}): React.ReactElement {
  const drop = useChatDropzone({ isOpen, canDrop, onFiles });
  return (
    <div data-testid="target" {...drop.handlers}>
      {drop.isActive ? "active" : "idle"}
    </div>
  );
}

it("tracks nested file drags and separates files from folders", () => {
  const onFiles = vi.fn();
  render(<DropTarget canDrop isOpen onFiles={onFiles} />);
  const target = screen.getByTestId("target");
  const file = new File(["hello"], "note.txt");
  const transfer = {
    types: ["Files"],
    dropEffect: "none",
    files: [file],
    items: [
      {
        kind: "file",
        webkitGetAsEntry: () => ({ isDirectory: true, name: "folder" }),
      },
      { kind: "file", webkitGetAsEntry: () => null, getAsFile: () => file },
      { kind: "string" },
    ],
  };
  fireEvent.dragEnter(target, { dataTransfer: transfer });
  fireEvent.dragEnter(target, { dataTransfer: transfer });
  fireEvent.dragLeave(target, { dataTransfer: transfer });
  expect(target.textContent).toBe("active");
  fireEvent.dragOver(target, { dataTransfer: transfer });
  expect(transfer.dropEffect).toBe("copy");
  fireEvent.drop(target, { dataTransfer: transfer });
  expect(onFiles).toHaveBeenCalledExactlyOnceWith([file], ["folder"]);
  expect(target.textContent).toBe("idle");
});

it("ignores text, rejects disabled drops and resets on drag end", () => {
  const onFiles = vi.fn();
  const { rerender } = render(
    <DropTarget canDrop={false} isOpen onFiles={onFiles} />,
  );
  const target = screen.getByTestId("target");
  fireEvent.dragEnter(target, { dataTransfer: { types: ["text/plain"] } });
  expect(target.textContent).toBe("idle");
  const transfer = {
    types: ["Files"],
    dropEffect: "copy",
    items: [],
    files: [],
  };
  fireEvent.dragEnter(target, { dataTransfer: transfer });
  fireEvent.dragOver(target, { dataTransfer: transfer });
  expect(transfer.dropEffect).toBe("none");
  fireEvent.drop(target, { dataTransfer: transfer });
  expect(onFiles).not.toHaveBeenCalled();
  fireEvent.dragEnter(target, { dataTransfer: transfer });
  fireEvent.dragEnd(window);
  expect(target.textContent).toBe("idle");
  rerender(<DropTarget canDrop isOpen onFiles={onFiles} />);
  const file = new File(["x"], "fallback.txt");
  fireEvent.drop(target, { dataTransfer: { ...transfer, files: [file] } });
  expect(onFiles).toHaveBeenCalledExactlyOnceWith([file], []);
});

it("guards file drops elsewhere only while the panel is open", () => {
  const onFiles = vi.fn();
  const { rerender } = render(<DropTarget canDrop isOpen onFiles={onFiles} />);
  expect(fireEvent.drop(window, { dataTransfer: { types: ["Files"] } })).toBe(
    false,
  );
  expect(
    fireEvent.drop(window, { dataTransfer: { types: ["text/plain"] } }),
  ).toBe(true);
  rerender(<DropTarget canDrop isOpen={false} onFiles={onFiles} />);
  expect(fireEvent.drop(window, { dataTransfer: { types: ["Files"] } })).toBe(
    true,
  );
});
