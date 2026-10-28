import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PlanPaletteButton } from "@/app/components/agents/plans/plan-palette-button";

import type * as FloatingUi from "@floating-ui/dom";

const floating = vi.hoisted(() => ({
  computePosition: vi.fn(),
  autoUpdate: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@floating-ui/dom", async (importOriginal) => ({
  ...(await importOriginal<typeof FloatingUi>()),
  computePosition: floating.computePosition,
  autoUpdate: floating.autoUpdate,
}));

beforeEach(() => {
  floating.computePosition.mockResolvedValue({ x: 12, y: 34 });
  floating.autoUpdate.mockImplementation(
    (reference: Element, panel: HTMLElement, update: () => void) => {
      update();
      return floating.stop;
    },
  );
});

afterEach(() => {
  floating.computePosition.mockReset();
  floating.autoUpdate.mockReset();
  floating.stop.mockReset();
});

// A description waits invisible until it is placed, so queries include hidden elements.
const HIDDEN = { hidden: true } as const;

function renderButton(showsOnPress = false): HTMLElement {
  render(
    <>
      <PlanPaletteButton
        tooltip="Adds an agent"
        showsOnPress={showsOnPress}
        wrapperClassName="grid"
      >
        Agent
      </PlanPaletteButton>
      <p>Outside</p>
    </>,
  );
  return screen.getByRole("button", { name: "Agent" });
}

it("shows the description on hover above the overlays at the computed place and hides it on leave", async () => {
  const button = renderButton();

  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  expect(button.parentElement?.className).toContain("grid");
  fireEvent.mouseEnter(button);
  const tooltip = await screen.findByRole("tooltip");

  expect(tooltip.textContent).toBe("Adds an agent");
  expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
  await vi.waitFor(() => expect(tooltip.style.visibility).toBe("visible"));
  expect(tooltip.style.left).toBe("12px");
  expect(tooltip.style.top).toBe("34px");
  expect(tooltip.parentElement).toBe(document.body);
  fireEvent.mouseLeave(button);

  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  expect(button.getAttribute("aria-describedby")).toBeNull();
  expect(floating.stop).toHaveBeenCalledOnce();
});

it("opens on keyboard focus, closes on blur, and Escape or a press dismisses it until the next focus", () => {
  const button = renderButton();

  fireEvent.focus(button);
  expect(screen.getByRole("tooltip", HIDDEN)).toBeDefined();
  fireEvent.keyDown(button, { key: "Enter" });
  expect(screen.getByRole("tooltip", HIDDEN)).toBeDefined();
  fireEvent.keyDown(button, { key: "Escape" });
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  fireEvent.blur(button);
  fireEvent.focus(button);
  expect(screen.getByRole("tooltip", HIDDEN)).toBeDefined();
  fireEvent.pointerDown(button);
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  fireEvent.mouseEnter(button);
  expect(screen.getByRole("tooltip", HIDDEN)).toBeDefined();
  fireEvent.click(button);
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  fireEvent.blur(button);
  fireEvent.mouseLeave(button);
  fireEvent.mouseEnter(button);
  fireEvent.dragStart(button);

  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
});

it("keeps a pressed description open until a press elsewhere, a second press or Escape", () => {
  const button = renderButton(true);

  fireEvent.pointerDown(button);
  fireEvent.click(button);
  expect(screen.getByRole("tooltip", HIDDEN)).toBeDefined();
  fireEvent.pointerDown(button);
  expect(screen.getByRole("tooltip", HIDDEN)).toBeDefined();
  fireEvent.pointerDown(screen.getByText("Outside"));
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  fireEvent.click(button);
  expect(screen.getByRole("tooltip", HIDDEN)).toBeDefined();
  fireEvent.click(button);
  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "Escape" });

  expect(screen.queryByRole("tooltip", HIDDEN)).toBeNull();
});

it("ignores a place computed after the description closed", async () => {
  let resolve: (position: { x: number; y: number }) => void = () => {};
  floating.computePosition.mockReturnValue(
    new Promise((settle) => {
      resolve = settle;
    }),
  );
  const button = renderButton();
  fireEvent.mouseEnter(button);
  const tooltip = screen.getByRole("tooltip", HIDDEN);

  fireEvent.mouseLeave(button);
  await act(async () => resolve({ x: 99, y: 99 }));

  expect(tooltip.style.left).toBe("");
  expect(tooltip.style.visibility).toBe("hidden");
});

it("warns and keeps the description hidden when it cannot be placed", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const failure = new Error("no layout");
  floating.computePosition.mockRejectedValue(failure);
  const button = renderButton();

  fireEvent.mouseEnter(button);

  await vi.waitFor(() =>
    expect(warn).toHaveBeenCalledWith(
      "Could not position the node palette tooltip.",
      failure,
    ),
  );
  expect(screen.getByRole("tooltip", HIDDEN).style.visibility).toBe("hidden");
});
