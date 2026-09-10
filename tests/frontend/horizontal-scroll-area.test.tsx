// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HorizontalScrollArea } from "@/app/components/ui/horizontal-scroll-area";

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

describe("HorizontalScrollArea", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides both fade edges when the content fits entirely", () => {
    const { container } = render(
      <HorizontalScrollArea>
        <p>Short content</p>
      </HorizontalScrollArea>,
    );

    const fades = container.querySelectorAll("[aria-hidden='true']");

    expect(fades.length).toBe(2);

    for (const fade of Array.from(fades)) {
      expect(fade.className).toContain("opacity-0");
    }
  });

  it("toggles the start and end fades based on scroll position", () => {
    const { container } = render(
      <HorizontalScrollArea>
        <div style={{ width: "2000px" }}>Wide content</div>
      </HorizontalScrollArea>,
    );

    const viewport = container.querySelector(
      ".pages-thin-scrollbar",
    ) as HTMLElement | null;

    expect(viewport).not.toBeNull();

    if (!viewport) {
      return;
    }

    const startFade = container.querySelector(
      ".pages-scroll-fade-start",
    ) as HTMLElement | null;
    const endFade = container.querySelector(
      ".pages-scroll-fade-end",
    ) as HTMLElement | null;

    expect(startFade).not.toBeNull();
    expect(endFade).not.toBeNull();

    if (!startFade || !endFade) {
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

    expect(startFade.className).toContain("opacity-0");
    expect(endFade.className).toContain("opacity-100");

    setViewportMetrics(viewport, {
      clientWidth: 100,
      scrollLeft: 200,
      scrollWidth: 500,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(startFade.className).toContain("opacity-100");
    expect(endFade.className).toContain("opacity-100");

    setViewportMetrics(viewport, {
      clientWidth: 100,
      scrollLeft: 400,
      scrollWidth: 500,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(startFade.className).toContain("opacity-100");
    expect(endFade.className).toContain("opacity-0");
  });

  it("falls back to the listener-only path when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);

    const { container } = render(
      <HorizontalScrollArea>
        <p>Content</p>
      </HorizontalScrollArea>,
    );

    const viewport = container.querySelector(
      ".pages-thin-scrollbar",
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

    const endFade = container.querySelector(".pages-scroll-fade-end");

    expect(endFade?.className).toContain("opacity-100");
  });

  it("forwards custom class names to every container", () => {
    const { container } = render(
      <HorizontalScrollArea
        className="outer-class"
        viewportClassName="viewport-class"
        contentClassName="content-class"
      >
        <p>Content</p>
      </HorizontalScrollArea>,
    );

    expect(container.querySelector(".outer-class")).not.toBeNull();
    expect(container.querySelector(".viewport-class")).not.toBeNull();
    expect(container.querySelector(".content-class")).not.toBeNull();
  });
});
