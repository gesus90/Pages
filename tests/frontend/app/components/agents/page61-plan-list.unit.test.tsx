import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { i18n, planServer, renderPlanPage } from "./page61-plan-fixture";

const scrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

async function choose(label: string, option: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

function listedTickets(): readonly string[] {
  const list = screen.getByRole("region", {
    name: i18n.t("plans.taskSources"),
  });
  return within(list)
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

it("filters the ticket list by the actual status and updates it on every change", async () => {
  renderPlanPage(planServer());
  await screen.findByRole("region", { name: i18n.t("plans.canvas") });
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Tickets" }));
  await screen.findByRole("region", { name: i18n.t("plans.taskSources") });
  expect(listedTickets()).toEqual([
    "SYN-1: Open work",
    "SYN-2: Ongoing",
    "SYN-3: Finished",
    "SYN-4: Next work",
  ]);
  const filter = i18n.t("plans.taskStatusFilter");
  await choose(filter, "To Do");
  expect(listedTickets()).toEqual(["SYN-1: Open work", "SYN-4: Next work"]);
  await choose(filter, "Done");
  expect(listedTickets()).toEqual(["SYN-3: Finished"]);
  await choose(filter, i18n.t("plans.openTasks"));
  expect(listedTickets()).toEqual([
    "SYN-1: Open work",
    "SYN-2: Ongoing",
    "SYN-4: Next work",
  ]);
  await choose(filter, i18n.t("plans.doneTasks"));
  expect(listedTickets()).toEqual(["SYN-3: Finished"]);
  await choose(filter, i18n.t("plans.allStatuses"));
  expect(listedTickets()).toHaveLength(4);
});

it("lets the owner delete the plan, after which the plan list no longer offers it", async () => {
  const server = planServer();
  renderPlanPage(server);
  await screen.findByRole("region", { name: i18n.t("plans.canvas") });
  const chooser = screen.getByRole("combobox", {
    name: i18n.t("plans.choosePlan"),
  });
  expect(chooser.textContent).toContain("Synthetic plan");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.deletePlan") }),
  );
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("plans.confirmDelete") }),
  );
  await waitFor(() => expect(server.deleted).toEqual(["plan"]));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.keyDown(
    screen.getByRole("combobox", { name: i18n.t("plans.choosePlan") }),
    { key: "Enter" },
  );
  const options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual([
    i18n.t("plans.newPlan"),
  ]);
});

it("offers no deletion to a user who may use but not edit the plan", async () => {
  renderPlanPage(planServer(false));
  await screen.findByRole("region", { name: i18n.t("plans.canvas") });
  expect(
    screen.queryByRole("button", { name: i18n.t("plans.deletePlan") }),
  ).toBeNull();
});
