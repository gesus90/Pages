// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KanbanScrollArea } from "@/app/components/tasks/kanban-scroll-area";

class FakeResizeObserver {
  private readonly callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(target: Element): void {
    const entry = {
      contentRect: target.getBoundingClientRect(),
      target,
    } as unknown as ResizeObserverEntry;

    this.callback([entry], this);
  }

  public unobserve(): void {}

  public disconnect(): void {}
}

function setViewportMetrics(
  element: HTMLElement,
  metrics: {
    readonly clientWidth: number;
    readonly scrollLeft: number;
    readonly scrollWidth: number;
  },
): void {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: metrics.clientWidth,
  });
  Object.defineProperty(element, "scrollWidth", {
    configurable: true,
    value: metrics.scrollWidth,
  });
  Object.defineProperty(element, "scrollLeft", {
    configurable: true,
    value: metrics.scrollLeft,
    writable: true,
  });
}

describe("KanbanScrollArea", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides both fade edges when the content fits entirely", () => {
    const { container } = render(
      <KanbanScrollArea>
        <p>Short content</p>
      </KanbanScrollArea>,
    );

    const fades = container.querySelectorAll("[aria-hidden='true']");

    expect(fades.length).toBe(2);

    for (const fade of Array.from(fades)) {
      expect(fade.className).not.toContain("fadeVisible");
    }
  });

  it("toggles the right and left fade based on scroll position", () => {
    const { container } = render(
      <KanbanScrollArea>
        <div style={{ width: "2000px" }}>Wide content</div>
      </KanbanScrollArea>,
    );

    const viewport = container.querySelector(
      "#tasks-kanban-viewport",
    ) as HTMLElement | null;

    expect(viewport).not.toBeNull();

    if (!viewport) {
      return;
    }

    setViewportMetrics(viewport, {
      clientWidth: 100,
      scrollLeft: 0,
      scrollWidth: 500,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    const fades = container.querySelectorAll("[aria-hidden='true']");
    const leftFade = fades[0] as HTMLElement | undefined;
    const rightFade = fades[1] as HTMLElement | undefined;

    expect(leftFade?.className).not.toContain("fadeVisible");
    expect(rightFade?.className).toContain("fadeVisible");

    setViewportMetrics(viewport, {
      clientWidth: 100,
      scrollLeft: 400,
      scrollWidth: 500,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(leftFade?.className).toContain("fadeVisible");
    expect(rightFade?.className).not.toContain("fadeVisible");

    setViewportMetrics(viewport, {
      clientWidth: 500,
      scrollLeft: 0,
      scrollWidth: 500,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(leftFade?.className).not.toContain("fadeVisible");
    expect(rightFade?.className).not.toContain("fadeVisible");
  });

  it("falls back to the listener-only path when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);

    const { container } = render(
      <KanbanScrollArea>
        <p>Content</p>
      </KanbanScrollArea>,
    );

    const viewport = container.querySelector(
      "#tasks-kanban-viewport",
    ) as HTMLElement | null;

    expect(viewport).not.toBeNull();

    if (!viewport) {
      return;
    }

    setViewportMetrics(viewport, {
      clientWidth: 50,
      scrollLeft: 0,
      scrollWidth: 200,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    const fades = container.querySelectorAll("[aria-hidden='true']");

    expect(fades[1]?.className).toContain("fadeVisible");
  });

  it("exposes the kanban viewport identifier used by tests", () => {
    const { container } = render(
      <KanbanScrollArea>
        <p>Content</p>
      </KanbanScrollArea>,
    );

    expect(container.querySelector("#tasks-kanban-viewport")).not.toBeNull();
  });
});
