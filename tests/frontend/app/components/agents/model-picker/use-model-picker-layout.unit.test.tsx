import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { open, renderPicker, search, trigger } from "./model-picker-fixture";

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "scrollTo");
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
});

function triggerRect(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return this.getAttribute("role") === "combobox" &&
        this.tagName === "BUTTON"
        ? new DOMRect(rect.left, rect.top, rect.width, rect.height)
        : new DOMRect(0, 0, 0, 0);
    },
  );
}

function setWindow(width: number, height: number): void {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", height);
}

function panel(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    "[data-model-picker-panel]",
  );
  if (!element) throw new Error("no panel");
  return element;
}

function listMaxHeight(): string {
  return (
    panel().querySelector<HTMLElement>("[style*='max-height']")?.style
      .maxHeight ?? ""
  );
}

describe("floating panel placement", () => {
  it("lies in the document body below the trigger where the room is", () => {
    setWindow(1000, 1000);
    triggerRect({ left: 50, top: 100, width: 200, height: 40 });
    const view = renderPicker({ mode: "floating" });

    open();

    expect(view.container.contains(panel())).toBe(false);
    expect(document.body.contains(panel())).toBe(true);
    expect(panel().style.left).toBe("50px");
    expect(panel().style.width).toBe("352px");
    expect(panel().style.top).toBe("144px");
    expect(panel().className).toContain("fixed");
    expect(listMaxHeight()).toBe("480px");
  });

  it("opens above the trigger when only that side has the room", () => {
    setWindow(1000, 1000);
    triggerRect({ left: 50, top: 800, width: 200, height: 40 });
    renderPicker({ mode: "floating" });

    open();

    expect(panel().style.bottom).toBe("204px");
    expect(panel().style.top).toBe("");
    expect(listMaxHeight()).toBe("480px");
  });

  it("keeps the panel inside a narrow window", () => {
    setWindow(300, 1000);
    triggerRect({ left: 250, top: 100, width: 100, height: 40 });
    renderPicker({ mode: "floating" });

    open();

    expect(panel().style.width).toBe("284px");
    expect(panel().style.left).toBe("8px");
  });

  it("takes the larger side when neither has the least height", () => {
    setWindow(1000, 500);
    triggerRect({ left: 50, top: 300, width: 200, height: 40 });
    renderPicker({ mode: "floating" });

    open();

    expect(panel().style.bottom).toBe("204px");
    expect(listMaxHeight()).toBe("228px");
  });

  it("keeps the floor for the list where both sides are small", () => {
    setWindow(1000, 300);
    triggerRect({ left: 50, top: 150, width: 200, height: 40 });
    renderPicker({ mode: "floating" });

    open();

    expect(listMaxHeight()).toBe("160px");
  });

  it("scales the room of the search field with the page's font size", () => {
    setWindow(1000, 400);
    triggerRect({ left: 50, top: 0, width: 200, height: 40 });
    document.documentElement.style.fontSize = "32px";
    renderPicker({ mode: "floating" });

    open();

    expect(listMaxHeight()).toBe("224px");
  });

  it("uses the default room when the font size is unreadable", () => {
    setWindow(1000, 400);
    triggerRect({ left: 50, top: 0, width: 200, height: 40 });
    document.documentElement.style.fontSize = "normal";
    renderPicker({ mode: "floating" });

    open();

    expect(listMaxHeight()).toBe("288px");
  });
});

describe("floating panel closing", () => {
  it("closes when the page scrolls, wheels or resizes outside the panel", () => {
    renderPicker({ mode: "floating" });

    for (const dispatch of [
      () => fireEvent.wheel(document.body),
      () => fireEvent.scroll(window),
      () => fireEvent.resize(window),
    ]) {
      open();
      expect(screen.getByRole("tree")).toBeTruthy();
      dispatch();
      expect(screen.queryByRole("tree")).toBeNull();
    }
  });

  it("stays open when the panel itself scrolls or wheels", () => {
    renderPicker({ mode: "floating" });
    open();

    fireEvent.wheel(screen.getByRole("tree"));
    fireEvent.scroll(screen.getByRole("tree"));

    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("stays open while the focus moves into the portaled panel", () => {
    renderPicker({ mode: "floating" });
    open();

    fireEvent.blur(trigger(), { relatedTarget: search() });

    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("closes when the focus leaves for an element outside the panel", () => {
    renderPicker({ mode: "floating" });
    open();
    const outside = document.createElement("button");
    document.body.append(outside);

    fireEvent.blur(trigger(), { relatedTarget: outside });

    expect(screen.queryByRole("tree")).toBeNull();
    outside.remove();
  });
});

describe("inline panel", () => {
  function inlineTriggerRect(left: number, top: number): void {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (
          this.getAttribute("role") === "combobox" &&
          this.tagName === "BUTTON"
        )
          return new DOMRect(left, top, 200, 40);
        if (this instanceof HTMLElement && this.dataset.clip !== undefined)
          return new DOMRect(0, 0, 300, 5000);
        return new DOMRect(0, 0, 0, 0);
      },
    );
  }

  function markVisibleOverflow(element: HTMLElement): void {
    element.style.overflowX = "visible";
    element.style.overflowY = "visible";
  }

  beforeEach(() => {
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 1000);
    markVisibleOverflow(document.documentElement);
    markVisibleOverflow(document.body);
  });
  afterEach(() => {
    document.body.removeAttribute("style");
  });

  it("hangs below the trigger and is as wide as its rows need", () => {
    inlineTriggerRect(20, 100);
    const view = renderPicker();
    markVisibleOverflow(view.container);

    open();

    expect(panel().style.minWidth).toBe("352px");
    expect(panel().className).toContain("absolute");
    expect(panel().className).toContain("top-full");
  });

  it("hangs above the trigger near the bottom of the window", () => {
    inlineTriggerRect(20, 900);
    const view = renderPicker();
    markVisibleOverflow(view.container);

    open();

    expect(panel().className).toContain("bottom-full");
  });

  it("never reaches past a container that clips its overflow", () => {
    inlineTriggerRect(20, 100);
    const view = renderPicker();
    markVisibleOverflow(view.container);
    view.container.dataset.clip = "";
    view.container.style.overflowX = "hidden";
    view.container.style.overflowY = "visible";

    open();

    expect(panel().style.minWidth).toBe("272px");
  });

  it("limits the list to the visible band of a clipping container", () => {
    inlineTriggerRect(20, 100);
    const view = renderPicker();
    markVisibleOverflow(view.container);
    view.container.dataset.clip = "";
    view.container.style.overflowX = "visible";
    view.container.style.overflowY = "auto";

    open();

    expect(
      panel().querySelector<HTMLElement>("[style*='max-height']")?.style
        .maxHeight,
    ).toBe("480px");
  });
});
