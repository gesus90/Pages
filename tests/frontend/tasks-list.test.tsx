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
    archivedAt: null,
    assigneeId: "user-1",
    assigneeName: "Admin User",
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
          labelsByWorkItem={{
            "item-1": [
              {
                color: "#3b82f6",
                createdAt: "2026-01-01",
                id: "label-1",
                name: "Feature",
                projectId: "project-1",
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
    expect(onSortChange).toHaveBeenCalledWith("project");

    await user.click(screen.getByText("Titel"));
    expect(onSortChange).toHaveBeenCalledWith("title");

    await user.click(screen.getByText("Status"));
    expect(onSortChange).toHaveBeenCalledWith("status");

    await user.click(screen.getByText("Priorität"));
    expect(onSortChange).toHaveBeenCalledWith("priority");

    await user.click(screen.getByText("Fällig am"));
    expect(onSortChange).toHaveBeenCalledWith("dueDate");
  });

  it("handles sorting across all sort fields and directions", async () => {
    const user = userEvent.setup();
    const i18n = createI18n(LANGUAGE.GERMAN);

    const items = [
      createWorkItem({
        dueAt: "2026-01-01",
        id: "1",
        priority: WORK_ITEM_PRIORITY.LOW,
        projectName: "Alpha",
        statusName: "Backlog",
        title: "Apple",
        updatedAt: "2026-01-01",
      }),
      createWorkItem({
        dueAt: "2026-02-01",
        id: "2",
        priority: WORK_ITEM_PRIORITY.URGENT,
        projectName: "Beta",
        statusName: "Done",
        title: "Banana",
        updatedAt: "2026-01-02",
      }),
    ];

    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <TasksList
          onOpenTask={vi.fn()}
          onSelectTask={vi.fn()}
          onSortChange={vi.fn()}
          selectedTaskId={null}
          sortField="priority"
          workItems={items}
        />
      </I18nextProvider>,
    );

    await user.click(screen.getByText("Priorität"));
    expect(screen.getByText("Dringend")).toBeInTheDocument();
    await user.click(screen.getByText("Priorität"));

    const itemsWithNulls = [
      createWorkItem({
        assigneeName: null,
        reporterName: null,
        dueAt: null,
        id: "1",
        title: "Apple",
      }),
      createWorkItem({
        assigneeName: "Admin User",
        reporterName: "Reporter User",
        dueAt: "2026-03-01",
        id: "2",
        title: "Banana",
      }),
    ];

    rerender(
      <I18nextProvider i18n={i18n}>
        <TasksList
          onOpenTask={vi.fn()}
          onSelectTask={vi.fn()}
          onSortChange={vi.fn()}
          selectedTaskId={null}
          sortField="dueDate"
          workItems={itemsWithNulls}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("Nicht zugewiesen")).toBeInTheDocument();

    for (const field of [
      "updated",
      "dueDate",
      "project",
      "status",
      "title",
    ] as const) {
      rerender(
        <I18nextProvider i18n={i18n}>
          <TasksList
            onOpenTask={vi.fn()}
            onSelectTask={vi.fn()}
            onSortChange={vi.fn()}
            selectedTaskId={null}
            sortField={field}
            workItems={items}
          />
        </I18nextProvider>,
      );
      expect(screen.getByText("Apple")).toBeInTheDocument();
    }
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
