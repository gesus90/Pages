import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useTicketPickerPosition } from "@/app/components/agents/plans/plan-node-card/plan-ticket-picker/use-ticket-picker-position";

interface Placement {
  readonly x: number;
  readonly y: number;
  readonly availableHeight: number;
}

const floating = vi.hoisted(() => {
  const state: {
    update: (() => void) | null;
    placement: Placement;
    pending: (() => void) | null;
    isHeld: boolean;
  } = {
    update: null,
    placement: { x: 10, y: 20, availableHeight: 300 },
    pending: null,
    isHeld: false,
  };
  return { state, stop: vi.fn() };
});

// Floating UI measures real layout, which jsdom lacks; the boundary reports fixed placements.
vi.mock("@floating-ui/dom", () => ({
  offset: (value: number) => ({ name: "offset", value }),
  flip: (options: unknown) => ({ name: "flip", options }),
  shift: (options: unknown) => ({ name: "shift", options }),
  size: (options: {
    readonly apply: (input: { readonly availableHeight: number }) => void;
  }) => ({ name: "size", options }),
  autoUpdate: (
    referenceElement: HTMLElement,
    floatingElement: HTMLElement,
    update: () => void,
  ) => {
    floating.state.update = update;
    update();
    return floating.stop;
  },
  computePosition: async (
    referenceElement: HTMLElement,
    floatingElement: HTMLElement,
    options: {
      readonly middleware: readonly {
        readonly name: string;
        readonly options?: {
          readonly apply?: (input: {
            readonly availableHeight: number;
          }) => void;
        };
      }[];
    },
  ) => {
    const placement = floating.state.placement;
    if (floating.state.isHeld)
      await new Promise<void>((resolve) => {
        floating.state.pending = resolve;
      });
    for (const middleware of options.middleware)
      middleware.options?.apply?.({
        availableHeight: placement.availableHeight,
      });
    return { x: placement.x, y: placement.y };
  },
}));

afterEach(() => {
  floating.state.update = null;
  floating.state.pending = null;
  floating.state.isHeld = false;
  floating.state.placement = { x: 10, y: 20, availableHeight: 300 };
  floating.stop.mockReset();
});

function elements(): {
  readonly field: HTMLElement;
  readonly panel: HTMLElement;
} {
  return {
    field: document.createElement("button"),
    panel: document.createElement("div"),
  };
}

it("keeps the panel transparent and inert until both elements exist", () => {
  const { field } = elements();
  const { result } = renderHook(() => useTicketPickerPosition(field, null));
  expect(result.current).toEqual({
    position: "fixed",
    left: 0,
    top: 0,
    opacity: 0,
    pointerEvents: "none",
  });
  expect(floating.state.update).toBeNull();
});

it("places the panel below its field and limits its height to the window", async () => {
  const { field, panel } = elements();
  const { result } = renderHook(() => useTicketPickerPosition(field, panel));
  await act(async () => {});
  expect(result.current).toEqual({
    position: "fixed",
    left: 10,
    top: 20,
    maxHeight: 300,
  });
});

it("keeps the placed styles for an unchanged measurement and stops following on unmount", async () => {
  const { field, panel } = elements();
  const { result, unmount } = renderHook(() =>
    useTicketPickerPosition(field, panel),
  );
  await act(async () => {});
  const placed = result.current;
  await act(async () => floating.state.update?.());
  expect(result.current).toBe(placed);
  for (const placement of [
    { x: 11, y: 20, availableHeight: 300 },
    { x: 11, y: 21, availableHeight: 300 },
    { x: 11, y: 21, availableHeight: 250 },
  ]) {
    floating.state.placement = placement;
    await act(async () => floating.state.update?.());
    expect(result.current).toEqual({
      position: "fixed",
      left: placement.x,
      top: placement.y,
      maxHeight: placement.availableHeight,
    });
  }
  unmount();
  expect(floating.stop).toHaveBeenCalledOnce();
});

it("ignores a placement that arrives after the panel closed", async () => {
  const { field, panel } = elements();
  floating.state.isHeld = true;
  const { result, unmount } = renderHook(() =>
    useTicketPickerPosition(field, panel),
  );
  const hidden = result.current;
  unmount();
  await act(async () => floating.state.pending?.());
  expect(result.current).toBe(hidden);
  expect(floating.stop).toHaveBeenCalledOnce();
});
