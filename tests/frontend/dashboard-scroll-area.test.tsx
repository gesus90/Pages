// @vitest-environment jsdom
import * as React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardScrollArea } from "@/app/components/dashboard/dashboard-scroll-area";

class FakeResizeObserver {
  private readonly callback: ResizeObserverCallback;
  public readonly observed: Element[] = [];

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(target: Element): void {
    this.observed.push(target);

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

describe("DashboardScrollArea", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides both fade edges when the content fits entirely", () => {
    const { container } = render(
      <DashboardScrollArea>
        <p>Short content</p>
      </DashboardScrollArea>,
    );

    const fades = container.querySelectorAll("[aria-hidden='true']");

    expect(fades.length).toBe(2);

    for (const fade of Array.from(fades)) {
      expect(fade.className).not.toContain("fadeVisible");
    }
  });

  it("toggles the bottom and top fade based on scroll position", () => {
    const { container } = render(
      <DashboardScrollArea>
        <div style={{ height: "2000px" }}>Tall content</div>
      </DashboardScrollArea>,
    );

    const viewport = container.querySelector(
      "#dashboard-viewport",
    ) as HTMLElement | null;

    expect(viewport).not.toBeNull();

    if (!viewport) {
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

    const fades = container.querySelectorAll("[aria-hidden='true']");
    const topFade = fades[0] as HTMLElement | undefined;
    const bottomFade = fades[1] as HTMLElement | undefined;

    expect(topFade?.className).not.toContain("fadeVisible");
    expect(bottomFade?.className).toContain("fadeVisible");

    setViewportMetrics(viewport, {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 400,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(topFade?.className).toContain("fadeVisible");
    expect(bottomFade?.className).not.toContain("fadeVisible");

    setViewportMetrics(viewport, {
      clientHeight: 500,
      scrollHeight: 500,
      scrollTop: 0,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(topFade?.className).not.toContain("fadeVisible");
    expect(bottomFade?.className).not.toContain("fadeVisible");
  });

  it("falls back to the listener-only path when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);

    const { container } = render(
      <DashboardScrollArea>
        <p>Content</p>
      </DashboardScrollArea>,
    );

    const viewport = container.querySelector(
      "#dashboard-viewport",
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

    const fades = container.querySelectorAll("[aria-hidden='true']");

    expect(fades[1]?.className).toContain("fadeVisible");
  });

  it("exposes the viewport identifier used by tests", () => {
    const { container } = render(
      <DashboardScrollArea>
        <p>Content</p>
      </DashboardScrollArea>,
    );

    expect(container.querySelector("#dashboard-viewport")).not.toBeNull();
  });
});
