// @vitest-environment jsdom
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

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
    readonly clientHeight: number;
    readonly scrollHeight: number;
    readonly scrollTop: number;
  },
): void {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    value: metrics.scrollTop,
    writable: true,
  });
}

describe("VerticalScrollArea", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides both fade edges when the content fits entirely", () => {
    const { container } = render(
      <VerticalScrollArea>
        <p>Short content</p>
      </VerticalScrollArea>,
    );

    const fades = container.querySelectorAll("[aria-hidden='true']");

    expect(fades.length).toBe(2);

    for (const fade of Array.from(fades)) {
      expect(fade.className).toContain("opacity-0");
    }
  });

  it("toggles the top and bottom fades based on scroll position", () => {
    const { container } = render(
      <VerticalScrollArea>
        <div style={{ height: "2000px" }}>Tall content</div>
      </VerticalScrollArea>,
    );

    const viewport = container.querySelector(
      ".pages-hover-scrollbar",
    ) as HTMLElement | null;

    expect(viewport).not.toBeNull();

    if (!viewport) {
      return;
    }

    const topFade = container.querySelector(
      ".pages-scroll-fade-top",
    ) as HTMLElement | null;
    const bottomFade = container.querySelector(
      ".pages-scroll-fade-bottom",
    ) as HTMLElement | null;

    expect(topFade).not.toBeNull();
    expect(bottomFade).not.toBeNull();

    if (!topFade || !bottomFade) {
      return;
    }

    setViewportMetrics(viewport, {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 0,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(topFade.className).toContain("opacity-0");
    expect(bottomFade.className).toContain("opacity-100");

    setViewportMetrics(viewport, {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 200,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(topFade.className).toContain("opacity-100");
    expect(bottomFade.className).toContain("opacity-100");

    setViewportMetrics(viewport, {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 400,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(topFade.className).toContain("opacity-100");
    expect(bottomFade.className).toContain("opacity-0");
  });

  it("falls back to the listener-only path when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);

    const { container } = render(
      <VerticalScrollArea>
        <p>Content</p>
      </VerticalScrollArea>,
    );

    const viewport = container.querySelector(
      ".pages-hover-scrollbar",
    ) as HTMLElement | null;

    expect(viewport).not.toBeNull();

    if (!viewport) {
      return;
    }

    setViewportMetrics(viewport, {
      clientHeight: 50,
      scrollHeight: 200,
      scrollTop: 0,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    const bottomFade = container.querySelector(".pages-scroll-fade-bottom");

    expect(bottomFade?.className).toContain("opacity-100");
  });

  it("forwards custom class names to every container", () => {
    const { container } = render(
      <VerticalScrollArea
        className="outer-class"
        viewportClassName="viewport-class"
        contentClassName="content-class"
      >
        <p>Content</p>
      </VerticalScrollArea>,
    );

    expect(container.querySelector(".outer-class")).not.toBeNull();
    expect(container.querySelector(".viewport-class")).not.toBeNull();
    expect(container.querySelector(".content-class")).not.toBeNull();
  });
});
