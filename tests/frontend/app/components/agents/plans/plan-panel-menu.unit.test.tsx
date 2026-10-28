import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanPanelMenu } from "@/app/components/agents/plans/plan-panel-menu";

import {
  i18n,
  planControl,
  planPage,
  planView,
  renderTranslated,
} from "./plan-panel-fixture";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

function openMenu(
  page: AgentPlanPage,
  options: {
    readonly control?: AgentPlanControl;
    readonly canEdit?: boolean;
  } = {},
): ReturnType<typeof vi.fn> {
  const onOpen = vi.fn();
  renderTranslated(
    <PlanPanelMenu
      page={page}
      control={options.control}
      canEdit={options.canEdit ?? true}
      onOpen={onOpen}
    />,
  );
  const trigger = screen.getByRole("button", {
    name: i18n.t("plans.manage.menu"),
  });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return onOpen;
}

function item(key: string): HTMLElement {
  return screen.getByRole("menuitem", { name: new RegExp(i18n.t(key)) });
}

it.each([
  ["plans.manage.new", "create"],
  ["plans.manage.edit", "edit"],
  ["plans.manage.cloneItem", "clone"],
  ["plans.manage.remove", "delete"],
] as const)("opens a dialog from the entry %s", (key, dialog) => {
  const onOpen = openMenu(planPage(), { control: planControl() });

  expect(item(key).getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(item(key));

  expect(onOpen).toHaveBeenCalledWith(dialog);
});

it("offers only what exists without a plan or workspace, and names why nothing is removed", () => {
  openMenu(planPage({ selected: null, workspaces: [] }));

  for (const key of [
    "plans.manage.new",
    "plans.manage.edit",
    "plans.manage.cloneItem",
    "plans.manage.remove",
  ])
    expect(item(key).getAttribute("aria-disabled")).toBe("true");
  expect(item("plans.manage.remove").textContent).toContain(
    i18n.t("plans.manage.noPlan"),
  );
});

it("lets only the owner remove and only an editor edit", () => {
  openMenu(planPage({ selected: planView({ ownerId: "someone" }) }), {
    canEdit: false,
  });

  expect(item("plans.manage.edit").getAttribute("aria-disabled")).toBe("true");
  expect(
    item("plans.manage.cloneItem").getAttribute("aria-disabled"),
  ).toBeNull();
  expect(item("plans.manage.remove").textContent).toContain(
    i18n.t("plans.manage.ownerOnly"),
  );
});

it("keeps a plan with an active run", () => {
  openMenu(planPage(), { control: planControl({ status: "running" }) });

  expect(item("plans.manage.remove").getAttribute("aria-disabled")).toBe(
    "true",
  );
  expect(item("plans.manage.remove").textContent).toContain(
    i18n.t("plans.manage.runActive"),
  );
});

it("lets the owner remove a plan whose last run ended", () => {
  const onOpen = openMenu(planPage(), {
    control: planControl({ status: "failed" }),
  });

  expect(item("plans.manage.remove").textContent).toBe(
    i18n.t("plans.manage.remove"),
  );
  fireEvent.click(item("plans.manage.remove"));

  expect(onOpen).toHaveBeenCalledWith("delete");
});
