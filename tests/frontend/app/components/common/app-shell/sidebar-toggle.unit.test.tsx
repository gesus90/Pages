import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { SidebarToggle } from "@/app/components/common/app-shell/sidebar-toggle";
import { createI18n } from "@/app/lib/i18n";

const i18n = createI18n("en");

function renderToggle(isCollapsed: boolean, onToggle = vi.fn()): void {
  render(
    <I18nextProvider i18n={i18n}>
      <SidebarToggle
        controlsId="main-navigation"
        isCollapsed={isCollapsed}
        onToggle={onToggle}
      />
    </I18nextProvider>,
  );
}

it("offers to collapse an open sidebar", () => {
  renderToggle(false);

  const button = screen.getByRole("button", { name: "Collapse navigation" });

  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.getAttribute("aria-controls")).toBe("main-navigation");
  expect(button.getAttribute("title")).toBe("Collapse navigation");
});

it("offers to expand a collapsed sidebar", () => {
  renderToggle(true);

  const button = screen.getByRole("button", { name: "Expand navigation" });

  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.getAttribute("title")).toBe("Expand navigation");
});

it("reports every click as a toggle request", () => {
  const onToggle = vi.fn();
  renderToggle(false, onToggle);

  fireEvent.click(screen.getByRole("button"));
  fireEvent.click(screen.getByRole("button"));

  expect(onToggle).toHaveBeenCalledTimes(2);
});
