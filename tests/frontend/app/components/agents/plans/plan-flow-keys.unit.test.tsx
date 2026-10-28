import { act } from "react";
import { createRoot } from "react-dom/client";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { keepPlanControlKeys } from "@/app/components/agents/plans/plan-flow-keys";

/** A card whose keys reach `onCanvasKey` unless the card keeps them. */
function Card(props: { readonly onCanvasKey: () => void }): React.ReactElement {
  return (
    <div onKeyDown={props.onCanvasKey}>
      <article onKeyDown={keepPlanControlKeys}>
        <button type="button">Run</button>
        <input aria-label="Name" />
        <div role="option" aria-selected="false" tabIndex={-1}>
          Choice
        </div>
        <span data-plan-handle="card">
          <button type="button">Drag handle</button>
        </span>
        <p tabIndex={-1}>Text</p>
      </article>
    </div>
  );
}

function renderCard(): ReturnType<typeof vi.fn> {
  const onCanvasKey = vi.fn();
  render(<Card onCanvasKey={onCanvasKey} />);
  return onCanvasKey;
}

it.each([
  { role: "button", name: "Run" },
  { role: "textbox", name: "Name" },
  { role: "option", name: "Choice" },
])(
  "keeps the keys of the $role $name away from the canvas",
  ({ role, name }) => {
    const control = (): HTMLElement => screen.getByRole(role, { name });
    const onCanvasKey = renderCard();

    fireEvent.keyDown(control(), { key: "Delete" });
    fireEvent.keyDown(control(), { key: "a", ctrlKey: true });

    expect(onCanvasKey).not.toHaveBeenCalled();
  },
);

it.each([
  { key: "s", ctrlKey: true },
  { key: "S", metaKey: true },
  { key: "Escape" },
])("lets the canvas see %o on a control", (init) => {
  const onCanvasKey = renderCard();

  fireEvent.keyDown(screen.getByRole("button", { name: "Run" }), init);

  expect(onCanvasKey).toHaveBeenCalledOnce();
});

it("lets the canvas move a card by its drag handle and by plain text", () => {
  const onCanvasKey = renderCard();

  fireEvent.keyDown(screen.getByRole("button", { name: "Drag handle" }), {
    key: "ArrowLeft",
  });
  fireEvent.keyDown(screen.getByText("Text"), { key: "Delete" });

  expect(onCanvasKey).toHaveBeenCalledTimes(2);
});

it("passes on keys whose target belongs to another document", async () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const frameDocument = frame.contentDocument;
  if (!frameDocument) throw new Error("The frame has no document.");
  const container = frameDocument.createElement("div");
  frameDocument.body.append(container);
  const root = createRoot(container);
  const onCanvasKey = vi.fn();
  await act(async () => root.render(<Card onCanvasKey={onCanvasKey} />));
  const button = frameDocument.querySelector("button");
  if (!button) throw new Error("The card has no button.");

  // The event is created in the frame's window, as a key pressed there would be.
  fireEvent.keyDown(button, { key: "Delete" });

  expect(onCanvasKey).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  frame.remove();
});
