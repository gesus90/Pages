import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  TicketPickerFooter,
  TicketPickerList,
} from "@/app/components/agents/plans/plan-node-card/plan-ticket-picker/ticket-picker-list";
import { useTicketPicker } from "@/app/components/agents/plans/plan-node-card/plan-ticket-picker/use-ticket-picker";

import { i18n, renderTranslated } from "../../plan-flow-fixture";
import { ticket } from "./ticket-picker-fixture";
import {
  field,
  openPicker,
  queryPanel,
  renderPicker,
  searchField,
  TICKETS,
} from "./ticket-picker-render";

function rows(): readonly HTMLElement[] {
  return screen.getAllByRole("option");
}

function statuses(panel: HTMLElement): readonly string[] {
  return within(panel)
    .getAllByRole("status")
    .map((status) => status.textContent ?? "");
}

it("lists every ticket with key, title, change time, phase and the chosen mark", () => {
  renderPicker({ taskId: "2" });
  const panel = openPicker();
  const [first, second] = rows();
  expect(first?.textContent).toContain("SYN-1");
  expect(first?.textContent).toContain("Open work");
  expect(first?.textContent).toContain("To Do");
  expect(first?.getAttribute("aria-selected")).toBe("false");
  expect(first?.getAttribute("title")).toContain("SYN-1: Open work\n");
  expect(first?.querySelector("time")?.getAttribute("dateTime")).toBe(
    "2026-01-03T08:00:00.000Z",
  );
  expect(second?.getAttribute("aria-selected")).toBe("true");
  expect(
    within(second ?? panel).getByLabelText(
      i18n.t("plans.ticketPicker.selected"),
    ),
  ).toBeDefined();
  expect(statuses(panel)).toContain(
    i18n.t("plans.ticketPicker.count", { count: 3 }),
  );
});

it("shows a phase the workflow does not list under the ticket's own status name", () => {
  renderPicker({
    tasks: [ticket("9", { statusKey: "archived", statusName: "Archived" })],
  });
  openPicker();
  expect(rows()[0]?.textContent).toContain("Archived");
});

it("moves the highlight with the pointer and chooses a row with a click", () => {
  const { onSelect } = renderPicker({ taskId: "1" });
  openPicker();
  const listbox = screen.getByRole("listbox");
  const second = rows()[1] ?? listbox;
  fireEvent.mouseMove(second);
  expect(searchField().getAttribute("aria-activedescendant")).toBe(second.id);
  fireEvent.mouseMove(second);
  expect(searchField().getAttribute("aria-activedescendant")).toBe(second.id);
  // Pressing a row keeps the focus in the search field.
  expect(fireEvent.mouseDown(second)).toBe(false);
  fireEvent.click(second);
  expect(onSelect).toHaveBeenCalledWith("2");
  expect(queryPanel()).toBeNull();
  expect(document.activeElement).toBe(field());
});

it("offers to reset a search without matches and counts the matches of a filter", () => {
  renderPicker();
  const panel = openPicker();
  fireEvent.change(searchField(), { target: { value: "work open" } });
  expect(statuses(panel)).toContain(
    i18n.t("plans.ticketPicker.matches", { count: 1, total: 3 }),
  );
  fireEvent.change(searchField(), { target: { value: "nothing" } });
  expect(statuses(panel)).toContain(i18n.t("plans.ticketPicker.noMatch"));
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByRole("listbox").closest(".hidden")).not.toBeNull();
  fireEvent.click(
    within(panel).getByRole("button", {
      name: i18n.t("plans.ticketPicker.reset"),
    }),
  );
  expect(rows()).toHaveLength(3);
});

it("says that the project has no tickets", () => {
  renderPicker({ tasks: [] });
  const panel = openPicker();
  expect(statuses(panel)).toContain(i18n.t("plans.ticketPicker.empty"));
  expect(
    within(panel).queryByRole("button", {
      name: i18n.t("plans.ticketPicker.retry"),
    }),
  ).toBeNull();
});

it("shows the first reading of the tickets and a later refresh", () => {
  const refresh = vi.fn();
  const first = renderPicker({
    tasks: [],
    tickets: { status: "loading", refresh },
  });
  let panel = openPicker();
  expect(statuses(panel)).toContain(i18n.t("plans.ticketPicker.loading"));
  first.unmount();
  renderPicker({ tasks: TICKETS, tickets: { status: "loading", refresh } });
  panel = openPicker();
  expect(panel.textContent).toContain(i18n.t("plans.ticketPicker.refreshing"));
  expect(rows()).toHaveLength(3);
});

it("offers a retry for a failed first reading", () => {
  const refresh = vi.fn();
  renderPicker({ tasks: [], tickets: { status: "error", refresh } });
  const panel = openPicker();
  expect(statuses(panel)).toContain(i18n.t("plans.ticketPicker.error"));
  refresh.mockClear();
  fireEvent.click(
    within(panel).getByRole("button", {
      name: i18n.t("plans.ticketPicker.retry"),
    }),
  );
  expect(refresh).toHaveBeenCalledOnce();
});

it("reports a failed first reading without a retry when nothing can read the tickets again", () => {
  function List(): React.ReactElement {
    const state = useTicketPicker({
      tasks: [],
      selectedId: "",
      disabled: false,
      onSelect: vi.fn(),
    });
    const props = {
      state,
      tasks: [],
      phases: [],
      selectedId: "",
      status: "error",
    } as const;
    return (
      <>
        <TicketPickerList {...props} />
        <TicketPickerFooter {...props} />
      </>
    );
  }
  renderTranslated(<List />);
  expect(screen.getAllByRole("status")[0]?.textContent).toBe(
    i18n.t("plans.ticketPicker.error"),
  );
  expect(screen.queryByRole("button")).toBeNull();
});

it("offers to retry a failed refresh beside the listed tickets", () => {
  const refresh = vi.fn();
  renderPicker({ tickets: { status: "error", refresh } });
  const panel = openPicker();
  refresh.mockClear();
  fireEvent.click(
    within(panel).getByRole("button", {
      name: i18n.t("plans.ticketPicker.refreshFailed"),
    }),
  );
  expect(refresh).toHaveBeenCalledOnce();
  expect(rows()).toHaveLength(3);
});
