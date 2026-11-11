import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useSidebarResize } from "@/app/components/common/app-shell/use-sidebar-resize";

const PROPERTY = "--app-sidebar-preferred";
const POINTER = 7;

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
  readonly shell: HTMLElement | null;
  readonly sidebar: HTMLElement | null;
  readonly onResizeStart: () => void;
  readonly onResizeEnd: (width: number) => void;
}

function Harness({
  shell,
  sidebar,
  onResizeStart,
  onResizeEnd,
}: HarnessProps): React.ReactElement {
  const { handlePointerDown } = useSidebarResize({
    shellRef: { current: shell },
    sidebarRef: { current: sidebar },
    preferredWidth: null,
    onResizeStart,
    onResizeEnd,
  });

  return (
    <div data-testid="edge" tabIndex={0} onPointerDown={handlePointerDown} />
  );
}

const captured = new Set<number>();
const setPointerCapture = vi.fn((pointerId: number) => captured.add(pointerId));
const releasePointerCapture = vi.fn((pointerId: number) =>
  captured.delete(pointerId),
);

let shell: HTMLElement;
let sidebar: HTMLElement;
let onResizeStart: ReturnType<typeof vi.fn<() => void>>;
let onResizeEnd: ReturnType<typeof vi.fn<(width: number) => void>>;

function renderEdge(overrides: Partial<HarnessProps> = {}): {
  readonly edge: HTMLElement;
  readonly unmount: () => void;
} {
  const view = render(
    <Harness
      shell={shell}
      sidebar={sidebar}
      onResizeStart={onResizeStart}
      onResizeEnd={onResizeEnd}
      {...overrides}
    />,
  );

  return { edge: screen.getByTestId("edge"), unmount: view.unmount };
}

function press(edge: HTMLElement, init: PointerEventInit = {}): boolean {
  return fireEvent.pointerDown(edge, {
    button: 0,
    pointerId: POINTER,
    clientX: 100,
    ...init,
  });
}

function move(edge: HTMLElement, clientX: number, pointerId = POINTER): void {
  fireEvent.pointerMove(edge, { pointerId, clientX });
}

beforeEach(() => {
  captured.clear();
  setPointerCapture.mockClear();
  releasePointerCapture.mockClear();
  onResizeStart = vi.fn<() => void>();
  onResizeEnd = vi.fn<(width: number) => void>();
  shell = document.createElement("div");
  sidebar = document.createElement("aside");
  sidebar.style.minWidth = "240px";
  vi.spyOn(sidebar, "getBoundingClientRect").mockImplementation(
    () => new FakeRect(260),
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

it("starts a drag with focus, pointer capture and no native drag", () => {
  const { edge } = renderEdge();

  const notPrevented = press(edge);

  expect(notPrevented).toBe(false);
  expect(document.activeElement).toBe(edge);
  expect(onResizeStart).toHaveBeenCalledTimes(1);
  expect(setPointerCapture).toHaveBeenCalledWith(POINTER);
  expect(onResizeEnd).not.toHaveBeenCalled();
});

it("puts the dragged width on the shell and reports it on release", () => {
  const { edge } = renderEdge();
  press(edge);

  move(edge, 140);

  expect(shell.style.getPropertyValue(PROPERTY)).toBe("300px");
  expect(onResizeEnd).not.toHaveBeenCalled();

  fireEvent.pointerUp(edge, { pointerId: POINTER, clientX: 140 });

  expect(onResizeEnd).toHaveBeenCalledExactlyOnceWith(300);
  expect(releasePointerCapture).toHaveBeenCalledWith(POINTER);
});

it("clamps the dragged width to the minimum and the maximum", () => {
  const { edge } = renderEdge();
  press(edge);

  move(edge, 5000);
  expect(shell.style.getPropertyValue(PROPERTY)).toBe("512px");

  move(edge, -5000);
  expect(shell.style.getPropertyValue(PROPERTY)).toBe("240px");
});

it("ignores moves of other pointers", () => {
  const { edge } = renderEdge();
  press(edge);

  move(edge, 180, POINTER + 1);

  expect(shell.style.getPropertyValue(PROPERTY)).toBe("");
});

it("reports the measured width when released without moving", () => {
  const { edge } = renderEdge();
  press(edge);

  fireEvent.pointerUp(edge, { pointerId: POINTER });

  expect(onResizeEnd).toHaveBeenCalledExactlyOnceWith(260);
});

it("stops following after the drag ended", () => {
  const { edge } = renderEdge();
  press(edge);
  fireEvent.pointerUp(edge, { pointerId: POINTER });

  move(edge, 200);

  expect(shell.style.getPropertyValue(PROPERTY)).toBe("");
  expect(onResizeEnd).toHaveBeenCalledTimes(1);
});

it("allows a new drag after the previous one ended", () => {
  const { edge } = renderEdge();
  press(edge);
  fireEvent.pointerUp(edge, { pointerId: POINTER });

  press(edge, { clientX: 50 });
  move(edge, 60);
  fireEvent.pointerUp(edge, { pointerId: POINTER });

  expect(onResizeStart).toHaveBeenCalledTimes(2);
  expect(onResizeEnd).toHaveBeenLastCalledWith(270);
});

it("ignores a second press while a drag runs", () => {
  const { edge } = renderEdge();
  press(edge);

  press(edge, { pointerId: POINTER + 1 });

  expect(onResizeStart).toHaveBeenCalledTimes(1);
  expect(setPointerCapture).toHaveBeenCalledTimes(1);
});

it("ignores presses of other buttons", () => {
  const { edge } = renderEdge();

  const notPrevented = press(edge, { button: 2 });

  expect(notPrevented).toBe(true);
  expect(onResizeStart).not.toHaveBeenCalled();
  expect(setPointerCapture).not.toHaveBeenCalled();
});

it.each([
  ["no shell", { shell: null }],
  ["no sidebar", { sidebar: null }],
])("does not start a drag with %s", (label, overrides) => {
  const { edge } = renderEdge(overrides);

  press(edge);

  expect(onResizeStart).not.toHaveBeenCalled();
  expect(setPointerCapture).not.toHaveBeenCalled();
});

it("ends the drag when the browser cancels the pointer", () => {
  const { edge } = renderEdge();
  press(edge);
  move(edge, 120);

  fireEvent.pointerCancel(edge, { pointerId: POINTER });

  expect(onResizeEnd).toHaveBeenCalledExactlyOnceWith(280);
});

it("ends the drag when the pointer capture is lost", () => {
  const { edge } = renderEdge();
  press(edge);
  move(edge, 110);

  fireEvent(edge, new Event("lostpointercapture"));

  expect(onResizeEnd).toHaveBeenCalledExactlyOnceWith(270);
  expect(releasePointerCapture).toHaveBeenCalledWith(POINTER);
});

it("ends the drag when the window loses focus", () => {
  const { edge } = renderEdge();
  press(edge);
  move(edge, 130);

  act(() => {
    window.dispatchEvent(new Event("blur"));
  });

  expect(onResizeEnd).toHaveBeenCalledExactlyOnceWith(290);
});

it("does not release a capture the handle no longer holds", () => {
  const { edge } = renderEdge();
  press(edge);
  captured.clear();

  fireEvent.pointerUp(edge, { pointerId: POINTER });

  expect(releasePointerCapture).not.toHaveBeenCalled();
  expect(onResizeEnd).toHaveBeenCalledTimes(1);
});

it("stops following without a report when the edge unmounts mid-drag", () => {
  const { edge, unmount } = renderEdge();
  press(edge);

  unmount();
  act(() => {
    window.dispatchEvent(new Event("blur"));
  });
  fireEvent.pointerUp(edge, { pointerId: POINTER });

  expect(releasePointerCapture).toHaveBeenCalledWith(POINTER);
  expect(onResizeEnd).not.toHaveBeenCalled();
});
