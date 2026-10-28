import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { i18n } from "../plan-flow-fixture";
import {
  field,
  openPicker,
  queryPanel,
  renderPicker,
  searchField,
} from "./plan-ticket-picker/ticket-picker-render";

it("names the chosen ticket with key, title and status in the field", () => {
  renderPicker({ taskId: "2" });
  expect(field().textContent).toContain("SYN-2");
  expect(field().textContent).toContain("Ongoing work");
  expect(field().getAttribute("title")).toBe(
    "SYN-2: Ongoing work · In Progress",
  );
  expect(field().getAttribute("aria-invalid")).toBe("false");
  expect(field().getAttribute("aria-expanded")).toBe("false");
});

it("marks a ticket that is gone as unavailable, without its identifier", () => {
  renderPicker({ taskId: "gone" });
  expect(field().textContent).toBe(i18n.t("plans.ticketUnavailable"));
  expect(field().getAttribute("aria-invalid")).toBe("true");
  expect(field().getAttribute("title")).toBe(
    i18n.t("plans.ticketUnavailableHint"),
  );
});

it("asks for a ticket while none is chosen", () => {
  renderPicker();
  expect(field().textContent).toBe(i18n.t("plans.ticketPicker.choose"));
  expect(field().getAttribute("title")).toBeNull();
});

it("opens on a click, reads the tickets again and closes on a second click", () => {
  const refresh = vi.fn();
  renderPicker({ tickets: { status: "idle", refresh } });
  const panel = openPicker();
  expect(refresh).toHaveBeenCalledOnce();
  expect(field().getAttribute("aria-expanded")).toBe("true");
  expect(field().getAttribute("aria-controls")).toBe(
    within(panel).getByRole("listbox").id,
  );
  expect(document.activeElement).toBe(searchField());
  fireEvent.click(field());
  expect(queryPanel()).toBeNull();
});

it("keeps a click on the field from reaching the canvas", () => {
  const { onCardEvent } = renderPicker();
  fireEvent.pointerDown(field());
  fireEvent.doubleClick(field());
  fireEvent.click(field());
  expect(onCardEvent).not.toHaveBeenCalled();
});

it("opens with ArrowDown and closes with Escape on the field, returning the focus to it", () => {
  renderPicker();
  fireEvent.keyDown(field(), { key: "Enter" });
  expect(queryPanel()).toBeNull();
  fireEvent.keyDown(field(), { key: "ArrowDown" });
  expect(queryPanel()).not.toBeNull();
  fireEvent.keyDown(field(), { key: "ArrowDown" });
  expect(queryPanel()).not.toBeNull();
  const escape = fireEvent.keyDown(field(), { key: "Escape" });
  expect(escape).toBe(false);
  expect(queryPanel()).toBeNull();
  expect(document.activeElement).toBe(field());
  expect(fireEvent.keyDown(field(), { key: "Escape" })).toBe(true);
});

it("chooses a row with the keyboard, changes the node's ticket and shows it in the field", () => {
  const { onSelect } = renderPicker({ taskId: "1" });
  openPicker();
  fireEvent.keyDown(searchField(), { key: "ArrowDown" });
  fireEvent.keyDown(searchField(), { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith("2");
  expect(queryPanel()).toBeNull();
  expect(field().textContent).toContain("Ongoing work");
});

it("opens without a phase list in the sources", () => {
  renderPicker({ phases: null });
  const panel = openPicker();
  expect(
    within(panel)
      .getAllByRole("button", { pressed: true })
      .map((chip) => chip.textContent),
  ).toEqual([i18n.t("plans.ticketPicker.all")]);
});

it("cannot open while disabled", () => {
  renderPicker({ disabled: true, taskId: "1" });
  expect(field()).toHaveProperty("disabled", true);
  fireEvent.keyDown(field(), { key: "ArrowDown" });
  expect(queryPanel()).toBeNull();
  expect(screen.queryByRole("listbox")).toBeNull();
});
