import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";

import { PlanPaletteTabs } from "@/app/components/agents/plans/plan-palette-tabs";

import { i18n, renderTranslated } from "./plan-panel-fixture";

import type {
  PlanPaletteTab,
  PlanPaletteView,
} from "@/app/components/agents/plans/use-plan-palette-view";

function Tabs(): React.ReactElement {
  const [tab, select] = useState<PlanPaletteTab>("nodes");
  const view: PlanPaletteView = {
    isOpen: true,
    tab,
    toggle: () => {},
    select,
    showTemplates: () => select("templates"),
  };
  return <PlanPaletteTabs view={view} baseId="palette" />;
}

function tabNamed(name: "nodes" | "templates"): HTMLElement {
  return screen.getByRole("tab", { name: i18n.t(`plans.palette.tab.${name}`) });
}

it("labels the two tabs and their panel, with only the shown tab in the tab order", () => {
  renderTranslated(<Tabs />);

  expect(
    screen.getByRole("tablist", { name: i18n.t("plans.palette.tabs") }),
  ).toBeDefined();
  expect(tabNamed("nodes").getAttribute("aria-selected")).toBe("true");
  expect(tabNamed("nodes").tabIndex).toBe(0);
  expect(tabNamed("templates").tabIndex).toBe(-1);
  expect(tabNamed("templates").id).toBe("palette-templates");
  expect(tabNamed("templates").getAttribute("aria-controls")).toBe(
    "palette-panel",
  );
  fireEvent.click(tabNamed("templates"));

  expect(tabNamed("templates").getAttribute("aria-selected")).toBe("true");
  expect(tabNamed("nodes").getAttribute("aria-selected")).toBe("false");
});

it.each([
  ["ArrowRight", "nodes", "templates"],
  ["ArrowLeft", "nodes", "templates"],
  ["ArrowRight", "templates", "nodes"],
  ["Home", "templates", "nodes"],
  ["End", "nodes", "templates"],
] as const)("%s from %s shows and focuses %s", (key, from, to) => {
  renderTranslated(<Tabs />);
  if (from === "templates") fireEvent.click(tabNamed("templates"));

  fireEvent.keyDown(tabNamed(from), { key });

  expect(tabNamed(to).getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(tabNamed(to));
});

it("leaves other keys to the browser", () => {
  renderTranslated(<Tabs />);
  const event = new KeyboardEvent("keydown", {
    key: "ArrowDown",
    bubbles: true,
    cancelable: true,
  });

  tabNamed("nodes").dispatchEvent(event);

  expect(event.defaultPrevented).toBe(false);
  expect(tabNamed("nodes").getAttribute("aria-selected")).toBe("true");
});
