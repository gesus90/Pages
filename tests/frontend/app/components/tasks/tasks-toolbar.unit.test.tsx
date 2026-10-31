import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { TasksToolbar } from "@/app/components/tasks/board/tasks-toolbar";
import { createI18n } from "@/app/lib/i18n";
import { DEFAULT_BOARD_PREFERENCES } from "@/definition/BoardPreferences";

import type { BoardPreferences } from "@/definition/BoardPreferences";

vi.mock("@/app/components/tasks/board/toolbar-title", () => ({
  ToolbarTitle: (): React.ReactElement => <h1>Tasks</h1>,
}));

function showToolbar(
  preferences: BoardPreferences = DEFAULT_BOARD_PREFERENCES,
): ReturnType<typeof vi.fn> {
  const update = vi.fn();
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <TasksToolbar
        archivedFilter="active"
        assignees={[]}
        board={{ preferences, searchText: preferences.search, update }}
        canFilterArchived
        labels={[]}
        milestones={[]}
        onArchivedChange={vi.fn()}
        onCreate={vi.fn()}
        projects={[]}
        statuses={[]}
        templates={[]}
      />
    </I18nextProvider>,
  );
  return update;
}

it("keeps the main controls visible and exposes only the three requested views", () => {
  const update = showToolbar();
  expect(screen.getByRole("group", { name: "Task scope" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: /search/i })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Project" })).toBeTruthy();
  const view = screen.getByRole("group", { name: "View" });
  expect(
    within(view)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Kanban", "List", "Milestones"]);
  fireEvent.click(within(view).getByRole("button", { name: "List" }));
  expect(update).toHaveBeenCalledWith({ view: "list" });
});

it("opens the complete filter panel without changing preferences and restores focus on Escape", async () => {
  const update = showToolbar();
  const trigger = screen.getByRole("button", { name: /filters/i });
  trigger.focus();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  const panel = await screen.findByRole("dialog", { name: "Filters" });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  for (const name of [
    "Type",
    "Status",
    "Priority",
    "Milestone",
    "Assignee",
    "Department",
    "Archive state",
  ]) {
    expect(within(panel).getByRole("combobox", { name })).toBeTruthy();
  }
  expect(within(panel).getByRole("button", { name: "Labels" })).toBeTruthy();
  expect(update).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull(),
  );
  expect(document.activeElement).toBe(trigger);
  expect(update).not.toHaveBeenCalled();
});

it("counts panel changes only and resets them without clearing the visible scope or project", async () => {
  const update = showToolbar({
    ...DEFAULT_BOARD_PREFERENCES,
    scope: "mine",
    project: "project-1",
    priority: "high",
    search: "needle",
  });
  const trigger = screen.getByRole("button", { name: /filters/i });
  expect(within(trigger).getByLabelText("1 active")).toBeTruthy();
  fireEvent.click(trigger);
  const panel = await screen.findByRole("dialog", { name: "Filters" });
  fireEvent.click(within(panel).getByRole("button", { name: "Reset" }));
  expect(update).toHaveBeenCalledWith(
    {
      assignee: "all",
      department: "all",
      labelIds: [],
      milestone: "all",
      priority: "all",
      status: "all",
      type: "work",
    },
    undefined,
  );
});
