import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useKeyboardInset } from "@/app/components/agents/plans/plan-agent-console/use-keyboard-inset";

/** A visual viewport stand-in whose size the test sets explicitly. */
class FakeViewport extends EventTarget {
  public height: number;
  public offsetTop = 0;

  public constructor(height: number) {
    super();
    this.height = height;
  }
}

function installViewport(viewport: FakeViewport | null): void {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
}

afterEach(() => {
  installViewport(null);
});

it("reports no inset where the browser has no visual viewport", () => {
  installViewport(null);
  const { result } = renderHook(() => useKeyboardInset());
  expect(result.current).toBe(0);
});

it("follows the covered height as the keyboard opens, scrolls and closes", () => {
  const viewport = new FakeViewport(window.innerHeight - 300.4);
  installViewport(viewport);
  const { result } = renderHook(() => useKeyboardInset());
  expect(result.current).toBe(300);
  viewport.offsetTop = 100;
  act(() => {
    viewport.dispatchEvent(new Event("scroll"));
  });
  expect(result.current).toBe(200);
  viewport.height = window.innerHeight + 50;
  viewport.offsetTop = 0;
  act(() => {
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(result.current).toBe(0);
});

it("stops listening to the viewport when unmounted", () => {
  const viewport = new FakeViewport(window.innerHeight);
  const removeListener = vi.spyOn(viewport, "removeEventListener");
  installViewport(viewport);
  const { unmount } = renderHook(() => useKeyboardInset());
  unmount();
  expect(removeListener.mock.calls.map((call) => call[0])).toEqual([
    "resize",
    "scroll",
  ]);
});
