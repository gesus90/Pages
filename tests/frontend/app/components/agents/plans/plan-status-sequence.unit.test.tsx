import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { PlanStatusSequence } from "@/app/components/agents/plans/plan-status-sequence";
import { createI18n } from "@/app/lib/i18n";

import { runStep, syntheticRun } from "../page72-run-fixture";

import type { RenderResult } from "@testing-library/react";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { ScrollViewport as OriginalViewport } from "@/app/components/ui/scroll-viewport";

const viewportMount = vi.hoisted(() => ({ isAttached: true }));

vi.mock("@/app/components/ui/scroll-viewport", async (importOriginal) => {
  const actual = await importOriginal<{
    readonly ScrollViewport: typeof OriginalViewport;
  }>();
  return {
    ...actual,
    // A viewport whose element never reaches the ref, as before mounting.
    ScrollViewport: (
      props: Parameters<typeof OriginalViewport>[0],
    ): React.ReactElement =>
      createElement(
        actual.ScrollViewport,
        viewportMount.isAttached ? props : { ...props, ref: undefined },
      ),
  };
});

const i18n = createI18n("en");
const STEPS: readonly AgentPlanStepResult[] = [
  runStep("start", { name: "Start", status: "succeeded" }),
  runStep("one", { name: "One", status: "running" }),
  runStep("two", { name: "Two", isBlocked: true }),
  runStep("three", { name: "Three" }),
  runStep("end", { name: "End" }),
];

afterEach(() => {
  viewportMount.isAttached = true;
});

function sequence(
  props: {
    readonly steps?: readonly AgentPlanStepResult[];
    readonly anchorId?: string | null;
    readonly selectedId?: string | null;
    readonly onSelect?: (id: string) => void;
  } = {},
): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <PlanStatusSequence
        run={syntheticRun()}
        steps={props.steps ?? STEPS}
        anchorId={props.anchorId ?? null}
        selectedId={props.selectedId ?? null}
        onSelect={props.onSelect ?? vi.fn()}
      />
    </I18nextProvider>
  );
}

function define(element: Element, values: Record<string, number>): void {
  for (const [name, value] of Object.entries(values))
    Object.defineProperty(element, name, { configurable: true, value });
}

/** Gives the viewport and its steps a layout and records the scroll position. */
function layOut(
  view: RenderResult,
  geometry: { readonly width: number; readonly scrollWidth: number },
  stride = 40,
): { readonly scrollLeft: () => number } {
  const viewport = screen.getByRole("group");
  let scrollLeft = -1;
  Object.defineProperty(viewport, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (next: number) => {
      scrollLeft = next;
    },
  });
  define(viewport, {
    clientWidth: geometry.width,
    scrollWidth: geometry.scrollWidth,
  });
  view.container
    .querySelectorAll("[data-status-step]")
    .forEach((entry, index) =>
      define(entry, { offsetLeft: index * stride, offsetWidth: 40 }),
    );
  return { scrollLeft: () => scrollLeft };
}

it("labels every step with its number, name and status and selects it on click", () => {
  const onSelect = vi.fn();
  render(sequence({ selectedId: "one", onSelect }));
  expect(
    screen.getByRole("group", { name: "Steps of the executed run revision" }),
  ).toBeTruthy();
  const blocked = screen.getByRole("button", {
    name: "3 · Two · Waiting · blocked by predecessor",
  });
  const selected = screen.getByRole("button", { name: "2 · One · Running" });
  expect(selected.getAttribute("aria-pressed")).toBe("true");
  expect(blocked.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(blocked);
  expect(onSelect).toHaveBeenCalledWith("two");
});

it("centers the anchor step inside the visible window", () => {
  const view = render(sequence());
  const layout = layOut(view, { width: 120, scrollWidth: 200 });
  view.rerender(sequence({ anchorId: "three" }));
  // Three steps fit; the window starts one step before the anchor.
  expect(layout.scrollLeft()).toBe(80);
  view.rerender(sequence({ anchorId: "start" }));
  expect(layout.scrollLeft()).toBe(0);
});

it("never scrolls past the end of the sequence", () => {
  const view = render(sequence());
  const layout = layOut(view, { width: 120, scrollWidth: 150 });
  view.rerender(sequence({ anchorId: "end" }));
  expect(layout.scrollLeft()).toBe(30);
});

it("keeps the position without an anchor among the steps", () => {
  const view = render(sequence());
  const layout = layOut(view, { width: 120, scrollWidth: 200 });
  view.rerender(sequence({ anchorId: "removed" }));
  expect(layout.scrollLeft()).toBe(-1);
});

it("measures a single step by its own width", () => {
  const steps = [runStep("only", { name: "Only" })];
  const view = render(sequence({ steps }));
  const layout = layOut(view, { width: 120, scrollWidth: 40 });
  view.rerender(sequence({ steps, anchorId: "only" }));
  expect(layout.scrollLeft()).toBe(0);
});

it("counts steps that overlap as one pixel apart", () => {
  const view = render(sequence());
  const layout = layOut(view, { width: 120, scrollWidth: 400 }, 0);
  view.rerender(sequence({ anchorId: "two" }));
  expect(layout.scrollLeft()).toBe(0);
});

it("does nothing for an empty sequence or before the viewport is mounted", () => {
  const empty = render(sequence({ steps: [], anchorId: "start" }));
  expect(empty.container.querySelectorAll("[data-status-step]")).toHaveLength(
    0,
  );
  empty.unmount();
  viewportMount.isAttached = false;
  render(sequence({ anchorId: "two" }));
  expect(screen.getByRole("group").scrollLeft).toBe(0);
});
