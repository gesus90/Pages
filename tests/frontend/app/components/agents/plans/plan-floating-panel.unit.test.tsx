import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanFloatingPanel } from "@/app/components/agents/plans/plan-floating-panel";

import { renderTranslated } from "./plan-flow-fixture";

function renderPanel(
  type: "loop" | "group" = "loop",
  children: React.ReactNode = <p>Settings</p>,
): ReturnType<typeof vi.fn> {
  const onClose = vi.fn();
  renderTranslated(
    <PlanFloatingPanel
      label="Loop settings"
      kicker="Edit loop"
      title="Review loop"
      type={type}
      closeLabel="Close loop settings"
      closeButton="Done"
      hint="Changes start no run."
      onClose={onClose}
    >
      {children}
    </PlanFloatingPanel>,
  );
  return onClose;
}

it("opens as a non-modal dialog whose heading takes the focus", () => {
  renderPanel();
  const panel = screen.getByRole("dialog", { name: "Loop settings" });

  expect(panel.getAttribute("aria-modal")).toBe("false");
  expect(panel.getAttribute("data-plan-panel")).toBe("loop");
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Review loop" }),
  );
  expect(screen.getByText("Edit loop").classList).toContain("text-plan-loop");
  expect(screen.getByText("Settings")).toBeDefined();
  expect(screen.getByText("Changes start no run.")).toBeDefined();
});

it("marks a group panel in the group color", () => {
  renderPanel("group");

  expect(screen.getByText("Edit loop").classList).toContain("text-plan-group");
});

it.each(["Close loop settings", "Done"])(
  "closes with the %s button",
  (name) => {
    const onClose = renderPanel();

    fireEvent.click(screen.getByRole("button", { name }));

    expect(onClose).toHaveBeenCalledOnce();
  },
);

it("closes on Escape unless a control inside used it or text is being composed", () => {
  const onClose = renderPanel(
    "loop",
    <input
      aria-label="Runs"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.preventDefault();
      }}
    />,
  );

  fireEvent.keyDown(screen.getByRole("textbox", { name: "Runs" }), {
    key: "Escape",
  });
  fireEvent.keyDown(document, { key: "Escape", isComposing: true });
  fireEvent.keyDown(document, { key: "Enter" });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });

  expect(onClose).toHaveBeenCalledOnce();
});
