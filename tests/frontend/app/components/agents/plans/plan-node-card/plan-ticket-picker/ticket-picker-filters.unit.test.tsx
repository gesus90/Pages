import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import { i18n } from "../../plan-flow-fixture";
import { openPicker, renderPicker } from "./ticket-picker-render";

function order(sort: string, direction: string): string {
  return i18n.t(`plans.ticketPicker.order.${sort}.${direction}`);
}

function phaseButton(panel: HTMLElement, value: string): HTMLElement {
  return within(panel).getByRole("button", {
    name: i18n.t("plans.ticketPicker.phaseFilter", { value }),
  });
}

function shownKeys(): readonly string[] {
  return screen
    .getAllByRole("option", { hidden: true })
    .map((row) => row.getAttribute("title")?.split(":")[0] ?? "");
}

async function openMenu(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.findByRole("menu");
}

it("filters by phases from the menu, names the choice and clears it with All phases", async () => {
  renderPicker();
  const panel = openPicker();
  const all = i18n.t("plans.ticketPicker.allPhases");
  const trigger = phaseButton(panel, all);
  let menu = await openMenu(trigger);
  expect(
    within(menu).getByRole("menuitemcheckbox", { name: all }),
  ).toHaveProperty("ariaChecked", "true");
  fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Done" }));
  // The menu stays open so that several phases can be chosen in a row.
  expect(screen.getByRole("menu")).toBe(menu);
  expect(shownKeys()).toEqual(["SYN-3"]);
  expect(trigger.getAttribute("aria-label")).toBe(
    i18n.t("plans.ticketPicker.phaseFilter", { value: "Done" }),
  );
  fireEvent.click(
    within(menu).getByRole("menuitemcheckbox", { name: "In Progress" }),
  );
  expect(shownKeys()).toEqual(["SYN-2", "SYN-3"]);
  expect(trigger.getAttribute("aria-label")).toBe(
    i18n.t("plans.ticketPicker.phaseFilter", {
      value: i18n.t("plans.ticketPicker.phaseCount", { count: 2 }),
    }),
  );
  fireEvent.keyDown(menu, { key: "Escape" });
  menu = await openMenu(trigger);
  fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: all }));
  expect(shownKeys()).toEqual(["SYN-1", "SYN-2", "SYN-3"]);
});

it("orders by title, turns the direction and returns to the newest first for dates", async () => {
  renderPicker();
  const panel = openPicker();
  const sortField = within(panel).getByRole("button", {
    name: i18n.t("plans.ticketPicker.sortField", {
      value: order("updated", "desc"),
    }),
  });
  let menu = await openMenu(sortField);
  fireEvent.click(
    within(menu).getByRole("menuitemradio", {
      name: i18n.t("plans.ticketPicker.sort.title"),
    }),
  );
  expect(shownKeys()).toEqual(["SYN-3", "SYN-2", "SYN-1"]);
  const direction = within(panel).getByRole("button", {
    name: i18n.t("plans.ticketPicker.direction", {
      value: order("title", "asc"),
    }),
  });
  fireEvent.click(direction);
  expect(shownKeys()).toEqual(["SYN-1", "SYN-2", "SYN-3"]);
  expect(direction.getAttribute("aria-label")).toBe(
    i18n.t("plans.ticketPicker.direction", { value: order("title", "desc") }),
  );
  menu = await openMenu(
    within(panel).getByRole("button", {
      name: i18n.t("plans.ticketPicker.sortField", {
        value: order("title", "desc"),
      }),
    }),
  );
  fireEvent.click(
    within(menu).getByRole("menuitemradio", {
      name: i18n.t("plans.ticketPicker.sort.created"),
    }),
  );
  const createdField = within(panel).getByRole("button", {
    name: i18n.t("plans.ticketPicker.sortField", {
      value: order("created", "desc"),
    }),
  });
  fireEvent.click(
    within(panel).getByRole("button", {
      name: i18n.t("plans.ticketPicker.direction", {
        value: order("created", "desc"),
      }),
    }),
  );
  // Choosing the current order again starts it from its first direction.
  menu = await openMenu(createdField);
  fireEvent.click(
    within(menu).getByRole("menuitemradio", {
      name: i18n.t("plans.ticketPicker.sort.created"),
    }),
  );
  expect(createdField.getAttribute("aria-label")).toBe(
    i18n.t("plans.ticketPicker.sortField", { value: order("created", "desc") }),
  );
});

it("toggles phases with the chips and clears them with All", () => {
  renderPicker();
  const panel = openPicker();
  const chips = within(panel).getByRole("group", {
    name: i18n.t("plans.ticketPicker.phase"),
  });
  const allChip = within(chips).getByRole("button", {
    name: i18n.t("plans.ticketPicker.all"),
  });
  expect(allChip.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(chips).getByRole("button", { name: "To Do" }));
  expect(shownKeys()).toEqual(["SYN-1"]);
  expect(
    within(chips)
      .getByRole("button", { name: "To Do" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(allChip.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(within(chips).getByRole("button", { name: "To Do" }));
  expect(shownKeys()).toHaveLength(3);
  fireEvent.click(within(chips).getByRole("button", { name: "Review" }));
  expect(screen.queryAllByRole("option", { hidden: true })).toHaveLength(0);
  fireEvent.click(allChip);
  expect(shownKeys()).toHaveLength(3);
});
