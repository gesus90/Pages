import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { SidebarResizeHandle } from "@/app/components/common/app-shell/sidebar-resize-handle";
import { createI18n } from "@/app/lib/i18n";

const i18n = createI18n("en");

let sidebar: HTMLElement;
let onResizeEnd: ReturnType<typeof vi.fn<(width: number) => void>>;

function renderHandle(isResizing = false, isVisible = true): HTMLElement {
  onResizeEnd = vi.fn<(width: number) => void>();
  vi.spyOn(sidebar, "getClientRects").mockImplementation(() =>
    Object.assign(isVisible ? [new DOMRect()] : [], { item: () => null }),
  );
  render(
    <I18nextProvider i18n={i18n}>
      <SidebarResizeHandle
        controlsId="main-navigation"
        isResizing={isResizing}
        preferredWidth={null}
        shellRef={{ current: document.createElement("div") }}
        sidebarRef={{ current: sidebar }}
        onResizeEnd={onResizeEnd}
        onResizeStart={vi.fn()}
      />
    </I18nextProvider>,
  );
  return screen.getByRole("separator", { name: "Resize navigation" });
}

beforeEach(() => {
  sidebar = document.createElement("aside");
  sidebar.style.minWidth = "240px";
  vi.spyOn(sidebar, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 280, 10),
  );
  window.innerWidth = 1000;
});

it("is a focusable vertical separator that controls the sidebar", () => {
  const handle = renderHandle();

  expect(handle.getAttribute("aria-orientation")).toBe("vertical");
  expect(handle.getAttribute("aria-controls")).toBe("main-navigation");
  expect(handle.getAttribute("title")).toBe("Resize navigation");
  expect(handle.tabIndex).toBe(0);
});

it("announces the measured width and its range", () => {
  const handle = renderHandle();

  expect(handle.getAttribute("aria-valuenow")).toBe("280");
  expect(handle.getAttribute("aria-valuemin")).toBe("240");
  expect(handle.getAttribute("aria-valuemax")).toBe("500");
  expect(handle.getAttribute("aria-valuetext")).toBe(
    "280 of at most 500 pixels",
  );
});

it("announces no value while the sidebar is hidden", () => {
  const handle = renderHandle(false, false);

  expect(handle.hasAttribute("aria-valuenow")).toBe(false);
  expect(handle.hasAttribute("aria-valuetext")).toBe(false);
});

it("highlights the edge only while it is dragged", () => {
  const idle = renderHandle(false).firstElementChild;
  expect(idle?.className).toContain("bg-transparent");
  expect(idle?.className).not.toContain(" bg-primary");
});

it("shows the dragging highlight", () => {
  const edge = renderHandle(true).firstElementChild;

  expect(edge?.className).toContain("bg-primary");
  expect(edge?.className).not.toContain("bg-transparent");
});

it("resizes with the keyboard through the shared hook", () => {
  const handle = renderHandle();

  act(() => {
    fireEvent.keyDown(handle, { key: "ArrowRight" });
  });

  expect(onResizeEnd).toHaveBeenCalledExactlyOnceWith(296);
});
