// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";

import { TasksList } from "@/app/components/tasks/tasks-list";
import { createI18n } from "@/app/lib/i18n";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { WorkItemDetail } from "@/definition/Task";

function createWorkItem(
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    departmentId: null,
    archivedAt: null,
    assigneeId: "user-1",
    assigneeGroupId: null,
    assigneeName: "Admin User",
    assigneeGroupName: null,
    reporterName: "Reporter User",
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    description: "Item description",
    dueAt: "2026-04-01",
    githubConflict: false,
    githubContentHash: null,
    githubIssueNumber: null,
    githubIssueState: null,
    githubIssueUpdatedAt: null,
    githubIssueUrl: null,
    githubLastSyncAt: null,
    githubLastError: null,
    id: "item-1",
    isDone: false,
    key: "PAGE-12",
    milestoneId: "milestone-1",
    milestoneName: "Pages v0.2",
    number: 12,
    parentId: null,
    parentKey: null,
    parentTitle: null,
    priority: WORK_ITEM_PRIORITY.HIGH,
    progressPercentage: 50,
    projectId: "project-1",
    projectName: "Pages",
    sortOrder: 1,
    startAt: null,
    statusId: "status-todo",
    statusKey: "todo",
    statusName: "To Do",
    subtaskCompleted: 2,
    subtaskTotal: 4,
    title: "Kanban implementieren",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

describe("TasksList", () => {
  it("renders work items in a sortable table and handles selection", async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    const onOpenTask = vi.fn();
    const onSortChange = vi.fn();

    const i18n = createI18n(LANGUAGE.GERMAN);
    render(
      <I18nextProvider i18n={i18n}>
        <TasksList
          sortDirection="asc"
          labelsByWorkItem={{
            "item-1": [
              {
                color: "#3b82f6",
                createdAt: "2026-01-01",
                id: "label-1",
                name: "Feature",
                updatedAt: "2026-01-02",
              },
            ],
          }}
          onOpenTask={onOpenTask}
          onSelectTask={onSelectTask}
          onSortChange={onSortChange}
          selectedTaskId="item-1"
          sortField="updated"
          workItems={[
            createWorkItem({
              parentKey: "PAGE-1",
              parentTitle: "Epic Parent",
            }),
            createWorkItem({
              dueAt: null,
              id: "item-2",
              key: "ASTRO-31",
              priority: WORK_ITEM_PRIORITY.NORMAL,
              projectName: "AstroLab",
              title: "MCP reparieren",
            }),
          ]}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("PAGE-12")).toBeInTheDocument();
    expect(screen.getByText("ASTRO-31")).toBeInTheDocument();
    expect(screen.getByText("AstroLab")).toBeInTheDocument();
    expect(screen.getByText("PAGE-1 · Epic Parent")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Labels")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();

    await user.click(screen.getByText("Kanban implementieren"));
    expect(onSelectTask).toHaveBeenCalledWith("PAGE-12");

    await user.dblClick(screen.getByText("MCP reparieren"));
    expect(onOpenTask).toHaveBeenCalledWith("ASTRO-31");

    await user.click(screen.getByText("Projekt"));
    expect(onSortChange).toHaveBeenCalledWith("project", "asc");

    await user.click(screen.getByText("Titel"));
    expect(onSortChange).toHaveBeenCalledWith("title", "asc");

    await user.click(screen.getByText("Status"));
    expect(onSortChange).toHaveBeenCalledWith("status", "asc");

    await user.click(screen.getByText("Priorität"));
    expect(onSortChange).toHaveBeenCalledWith("priority", "asc");

    await user.click(screen.getByText("Fällig am"));
    expect(onSortChange).toHaveBeenCalledWith("dueDate", "asc");
  });

  it("flips the direction of the sorted column and starts others ascending", async () => {
    const user = userEvent.setup();
    const i18n = createI18n(LANGUAGE.GERMAN);
    const onSortChange = vi.fn();
    const items = [createWorkItem({ id: "1", title: "Apple" })];

    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <TasksList
          onOpenTask={vi.fn()}
          onSelectTask={vi.fn()}
          onSortChange={onSortChange}
          selectedTaskId={null}
          sortDirection="asc"
          sortField="priority"
          workItems={items}
        />
      </I18nextProvider>,
    );

    await user.click(screen.getByText("Priorität"));
    expect(onSortChange).toHaveBeenLastCalledWith("priority", "desc");

    rerender(
      <I18nextProvider i18n={i18n}>
        <TasksList
          onOpenTask={vi.fn()}
          onSelectTask={vi.fn()}
          onSortChange={onSortChange}
          selectedTaskId={null}
          sortDirection="desc"
          sortField="priority"
          workItems={items}
        />
      </I18nextProvider>,
    );

    await user.click(screen.getByText("Priorität"));
    expect(onSortChange).toHaveBeenLastCalledWith("priority", "asc");

    await user.click(screen.getByText("Titel"));
    expect(onSortChange).toHaveBeenLastCalledWith("title", "asc");
  });

  it("renders the items in the order it receives them", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksList
          onOpenTask={vi.fn()}
          onSelectTask={vi.fn()}
          onSortChange={vi.fn()}
          selectedTaskId={null}
          sortDirection="asc"
          sortField="title"
          workItems={[
            createWorkItem({ id: "1", title: "Zebra" }),
            createWorkItem({ id: "2", title: "Apple" }),
          ]}
        />
      </I18nextProvider>,
    );

    const titles = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent);

    expect(titles[0]).toContain("Zebra");
    expect(titles[1]).toContain("Apple");
  });

  it("shows the show-more button when the page size is exceeded", async () => {
    const user = userEvent.setup();
    const i18n = createI18n(LANGUAGE.GERMAN);
    const items: WorkItemDetail[] = Array.from({ length: 110 }, (_, index) =>
      createWorkItem({
        id: `row-${index}`,
        key: `PAGE-${100 + index}`,
        sortOrder: index + 1,
        title: `Row ${index}`,
      }),
    );

    render(
      <I18nextProvider i18n={i18n}>
        <TasksList
          sortDirection="asc"
          onOpenTask={vi.fn()}
          onSelectTask={vi.fn()}
          onSortChange={vi.fn()}
          selectedTaskId={null}
          sortField="updated"
          workItems={items}
        />
      </I18nextProvider>,
    );

    expect(screen.getAllByText(/^Row \d+$/)).toHaveLength(100);

    const showMore = screen.getByRole("button", { name: /weitere anzeigen/ });

    await user.click(showMore);

    expect(screen.getAllByText(/^Row \d+$/)).toHaveLength(110);
  });
});
