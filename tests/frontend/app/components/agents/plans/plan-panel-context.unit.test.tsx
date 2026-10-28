import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanPanelContext } from "@/app/components/agents/plans/plan-panel-context";

import { i18n, planPage, planView, renderRouted } from "./plan-panel-fixture";

const DIRECTORY = {
  persons: [],
  groups: [],
  departments: [{ id: "sales", name: "Sales" }],
};

function team(): string | null | undefined {
  return document.querySelector("[data-plan-team]")?.textContent;
}

it("opens another plan by its address and describes plans without a workspace", async () => {
  const second = planView({
    id: "plan two",
    name: "Second",
    isWorkspaceMissing: true,
  });
  const { router } = renderRouted(
    <PlanPanelContext page={planPage({ plans: [planView(), second] })} />,
  );
  const label = i18n.t("plans.panel.openPlan");

  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), {
    key: "Enter",
  });
  const listbox = await screen.findByRole("listbox");
  expect(listbox.textContent).toContain(
    `Project · ${i18n.t("plans.manage.withoutWorkspace")}`,
  );
  fireEvent.click(screen.getByRole("option", { name: "Second" }));

  await waitFor(() =>
    expect(router.state.location.search).toBe("?planId=plan%20two"),
  );
  expect(
    screen
      .getByRole("link", { name: i18n.t("plans.panel.manageWorkspaces") })
      .getAttribute("href"),
  ).toBe("/agents/workspaces");
});

it("offers no plan choice without plans and says that a new plan has no team", () => {
  renderRouted(
    <PlanPanelContext page={planPage({ selected: null, plans: [] })} />,
  );

  expect(screen.queryByRole("combobox")).toBeNull();
  expect(team()).toBe(i18n.t("plans.panel.team.none"));
});

it("names the team a new plan would belong to, or an unknown one", () => {
  const view = renderRouted(
    <PlanPanelContext
      page={planPage({
        selected: null,
        teamDepartmentId: "sales",
        directory: DIRECTORY,
      })}
    />,
  );
  expect(team()).toBe(i18n.t("plans.panel.team.new", { name: "Sales" }));
  view.unmount();

  renderRouted(
    <PlanPanelContext
      page={planPage({ selected: null, teamDepartmentId: "gone" })}
    />,
  );

  expect(team()).toBe(
    i18n.t("plans.panel.team.new", {
      name: i18n.t("plans.panel.team.unknown"),
    }),
  );
});

it("names the team that shares a saved plan and says who moves it", () => {
  const selected = planView({ departmentId: "sales", ownerId: "someone" });
  renderRouted(
    <PlanPanelContext
      page={planPage({ selected, plans: [selected], directory: DIRECTORY })}
    />,
  );

  expect(team()).toBe(i18n.t("plans.panel.team.shared", { name: "Sales" }));
  expect(
    screen.getByText(i18n.t("plans.panel.projectOwnerOnly")),
  ).toBeDefined();
});

it("keeps the owner's note away from the owner, readers and plans without a team", () => {
  const owned = planView();
  const view = renderRouted(<PlanPanelContext page={planPage()} />);
  expect(team()).toBe(i18n.t("plans.panel.team.none"));
  expect(screen.queryByText(i18n.t("plans.panel.projectOwnerOnly"))).toBeNull();
  view.unmount();

  const read = planView({ ownerId: "someone", canEdit: false });
  renderRouted(
    <PlanPanelContext page={planPage({ selected: read, plans: [owned] })} />,
  );

  expect(screen.queryByText(i18n.t("plans.panel.projectOwnerOnly"))).toBeNull();
});

it("selects no plan while plans exist but none is open", async () => {
  renderRouted(
    <PlanPanelContext
      page={planPage({ selected: null, plans: [planView()] })}
    />,
  );
  const choice = screen.getByRole("combobox", {
    name: i18n.t("plans.panel.openPlan"),
  });

  expect(choice.textContent).toBe("");
  fireEvent.keyDown(choice, { key: "Enter" });

  expect(
    (
      await screen.findByRole("option", { name: "Synthetic plan" })
    ).getAttribute("aria-selected"),
  ).toBe("false");
});
