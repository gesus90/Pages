import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { i18n } from "../../plan-flow-fixture";
import {
  field,
  openPicker,
  queryPanel,
  renderPicker,
  searchField,
} from "./ticket-picker-render";

async function openPhaseMenu(panel: HTMLElement): Promise<HTMLElement> {
  fireEvent.keyDown(
    within(panel).getByRole("button", {
      name: i18n.t("plans.ticketPicker.phaseFilter", {
        value: i18n.t("plans.ticketPicker.allPhases"),
      }),
    }),
    { key: "Enter" },
  );
  return screen.findByRole("menu");
}

it("keeps pointer, wheel and key events of the panel away from the card", () => {
  const { onCardEvent } = renderPicker();
  const panel = openPicker();
  onCardEvent.mockClear();
  fireEvent.pointerDown(panel);
  fireEvent.click(panel);
  fireEvent.doubleClick(panel);
  fireEvent.wheel(panel);
  fireEvent.keyDown(searchField(), { key: "Delete" });
  expect(onCardEvent).not.toHaveBeenCalled();
  expect(queryPanel()).not.toBeNull();
});

it("lets Ctrl+S and Cmd+S through to the page's save", () => {
  const { onCardEvent } = renderPicker();
  openPicker();
  onCardEvent.mockClear();
  fireEvent.keyDown(searchField(), { key: "S", ctrlKey: true });
  fireEvent.keyDown(searchField(), { key: "s", metaKey: true });
  expect(onCardEvent).toHaveBeenCalledTimes(2);
  expect(queryPanel()).not.toBeNull();
});

it("closes with Escape in the panel and returns the focus to the field", () => {
  renderPicker();
  openPicker();
  expect(fireEvent.keyDown(searchField(), { key: "Escape" })).toBe(false);
  expect(queryPanel()).toBeNull();
  expect(document.activeElement).toBe(field());
});

it("closes with Escape anywhere on the page, but not for other keys", () => {
  renderPicker();
  openPicker();
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(queryPanel()).not.toBeNull();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(queryPanel()).toBeNull();
  expect(document.activeElement).toBe(field());
});

it("leaves Escape inside a filter menu to the menu", async () => {
  renderPicker();
  const panel = openPicker();
  const menu = await openPhaseMenu(panel);
  fireEvent.keyDown(within(menu).getAllByRole("menuitemcheckbox")[0] ?? menu, {
    key: "Escape",
  });
  expect(queryPanel()).not.toBeNull();
});

it("closes on a pointer outside the panel without a choice, but not inside it, its field or its menus", async () => {
  const { onSelect } = renderPicker({ taskId: "1" });
  const panel = openPicker();
  fireEvent.pointerDown(searchField());
  fireEvent.pointerDown(field());
  const menu = await openPhaseMenu(panel);
  fireEvent.pointerDown(menu);
  expect(queryPanel()).not.toBeNull();
  fireEvent.pointerDown(document.body);
  expect(queryPanel()).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});

it("closes when the focus leaves for another control, but not for its field or nowhere", () => {
  renderPicker();
  openPicker();
  const outside = document.createElement("button");
  document.body.append(outside);
  fireEvent.blur(searchField(), { relatedTarget: null });
  fireEvent.blur(searchField(), { relatedTarget: field() });
  expect(queryPanel()).not.toBeNull();
  fireEvent.blur(searchField(), { relatedTarget: outside });
  expect(queryPanel()).toBeNull();
  outside.remove();
});

it("names the highlighted row as the search field's active descendant", () => {
  renderPicker({ tasks: [] });
  openPicker();
  expect(searchField().getAttribute("aria-activedescendant")).toBeNull();
});

it("retries a failed refresh and keeps the focus in the search", () => {
  const refresh = vi.fn();
  renderPicker({ tasks: [], tickets: { status: "error", refresh } });
  openPicker();
  refresh.mockClear();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.ticketPicker.retry") }),
  );
  expect(refresh).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(searchField());
});

it("searches as the person types", () => {
  renderPicker();
  openPicker();
  fireEvent.change(searchField(), { target: { value: "ongoing" } });
  expect(searchField()).toHaveProperty("value", "ongoing");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(searchField().getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("listbox").id + "-0",
  );
});
