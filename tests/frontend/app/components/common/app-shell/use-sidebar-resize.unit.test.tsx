import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useSidebarResize } from "@/app/components/common/app-shell/use-sidebar-resize";

import type { RefObject } from "react";

class FakeRect implements DOMRect {
  public readonly x = 0;
  public readonly y = 0;
  public readonly top = 0;
  public readonly left = 0;
  public readonly right = 0;
  public readonly bottom = 0;
  public readonly height = 0;
  public readonly width: number;

  /** Carries only the width the hook reads. */
  public constructor(width: number) {
    this.width = width;
  }

  /** The hook never serializes the rectangle. */
  public toJSON(): object {
    return {};
  }
}

interface HarnessProps {
  readonly shellRef: RefObject<HTMLElement | null>;
  readonly sidebarRef: RefObject<HTMLElement | null>;
  readonly preferredWidth: number | null;
  readonly onResizeStart: () => void;
  readonly onResizeEnd: (width: number) => void;
}

function Harness(props: HarnessProps): React.ReactElement {
  const { range, handlePointerDown, handleKeyDown } = useSidebarResize(props);
  const description = range
    ? `${range.width}/${range.minimum}/${range.maximum}`
    : "none";

  return (
    <div
      data-range={description}
      data-testid="edge"
      role="separator"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    />
  );
}

const captured = new Set<number>();
const setPointerCapture = vi.fn((pointerId: number) => captured.add(pointerId));
const releasePointerCapture = vi.fn((pointerId: number) =>
  captured.delete(pointerId),
);

let sidebarWidth = 260;
let isSidebarVisible = true;
let shell: HTMLElement;
let sidebar: HTMLElement;
let onResizeStart: ReturnType<typeof vi.fn<() => void>>;
let onResizeEnd: ReturnType<typeof vi.fn<(width: number) => void>>;

function renderHarness(overrides: Partial<HarnessProps> = {}): {
  readonly edge: HTMLElement;
  readonly rerenderWith: (next: Partial<HarnessProps>) => void;
  readonly unmount: () => void;
} {
  const props: HarnessProps = {
    shellRef: { current: shell },
    sidebarRef: { current: sidebar },
    preferredWidth: null,
    onResizeStart,
    onResizeEnd,
    ...overrides,
  };
  const view = render(<Harness {...props} />);

  return {
    edge: screen.getByTestId("edge"),
    rerenderWith: (next) => view.rerender(<Harness {...props} {...next} />),
    unmount: view.unmount,
  };
}

function rangeOf(edge: HTMLElement): string | null {
  return edge.getAttribute("data-range");
}

beforeEach(() => {
  sidebarWidth = 260;
  isSidebarVisible = true;
  captured.clear();
  setPointerCapture.mockClear();
  releasePointerCapture.mockClear();
  onResizeStart = vi.fn<() => void>();
  onResizeEnd = vi.fn<(width: number) => void>();
  shell = document.createElement("div");
  sidebar = document.createElement("aside");
  sidebar.style.minWidth = "240px";
  vi.spyOn(sidebar, "getBoundingClientRect").mockImplementation(
    () => new FakeRect(sidebarWidth),
  );
  vi.spyOn(sidebar, "getClientRects").mockImplementation(() =>
    Object.assign(isSidebarVisible ? [new FakeRect(sidebarWidth)] : [], {
      item: () => null,
    }),
  );
  window.innerWidth = 1024;
  for (const [name, method] of [
    ["setPointerCapture", setPointerCapture],
    ["releasePointerCapture", releasePointerCapture],
    ["hasPointerCapture", (id: number) => captured.has(id)],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: method,
    });
  }
});

afterEach(() => {
  // Unmounting detaches a running drag, which still needs the pointer capture stubs.
  cleanup();
  vi.restoreAllMocks();
  for (const name of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
  ]) {
    Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

it("has no range until the sidebar is measured and shown", () => {
  isSidebarVisible = false;

  const { edge } = renderHarness();

  expect(rangeOf(edge)).toBe("none");
});

it("measures width, designed minimum and half the viewport as maximum", () => {
  const { edge } = renderHarness();

  expect(rangeOf(edge)).toBe("260/240/512");
});

it("never lets the maximum fall below the designed minimum", () => {
  sidebar.style.minWidth = "700px";
  sidebarWidth = 700;

  const { edge } = renderHarness();

  expect(rangeOf(edge)).toBe("700/700/700");
});

it("uses a minimum of zero when the stylesheet gives the sidebar none", () => {
  sidebar.style.minWidth = "";

  const { edge } = renderHarness();

  expect(rangeOf(edge)).toBe("260/0/512");
});

it("measures again after the window resized and while the sidebar shows", () => {
  const { edge } = renderHarness();

  window.innerWidth = 800;
  sidebarWidth = 300;
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });

  expect(rangeOf(edge)).toBe("300/240/400");

  isSidebarVisible = false;
  sidebarWidth = 100;
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });

  expect(rangeOf(edge)).toBe("300/240/400");
});

it("measures again when the preferred width changes and stops listening on unmount", () => {
  const removeListener = vi.spyOn(window, "removeEventListener");
  const { edge, rerenderWith, unmount } = renderHarness();

  sidebarWidth = 320;
  rerenderWith({ preferredWidth: 320 });

  expect(rangeOf(edge)).toBe("320/240/512");

  unmount();

  expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
});

it("does nothing without a sidebar", () => {
  const { edge } = renderHarness({ sidebarRef: { current: null } });

  fireEvent.pointerDown(edge, { button: 0, pointerId: 1, clientX: 10 });
  fireEvent.keyDown(edge, { key: "Home" });

  expect(rangeOf(edge)).toBe("none");
  expect(onResizeStart).not.toHaveBeenCalled();
  expect(onResizeEnd).not.toHaveBeenCalled();
});

it.each([
  ["ArrowLeft", false, 244],
  ["ArrowRight", false, 276],
  ["ArrowLeft", true, 240],
  ["ArrowRight", true, 324],
  ["Home", false, 240],
  ["End", false, 512],
])("resizes with %s (shift: %s) to %i pixels", (key, shiftKey, expected) => {
  const { edge } = renderHarness();

  const notPrevented = fireEvent.keyDown(edge, { key, shiftKey });

  expect(notPrevented).toBe(false);
  expect(onResizeEnd).toHaveBeenCalledExactlyOnceWith(expected);
});

it("keeps keyboard resizing inside the allowed range", () => {
  sidebarWidth = 500;
  const { edge } = renderHarness();

  fireEvent.keyDown(edge, { key: "ArrowRight", shiftKey: true });

  expect(onResizeEnd).toHaveBeenLastCalledWith(512);
});

it("leaves other keys alone", () => {
  const { edge } = renderHarness();

  const notPrevented = fireEvent.keyDown(edge, { key: "Enter" });

  expect(notPrevented).toBe(true);
  expect(onResizeEnd).not.toHaveBeenCalled();
});
