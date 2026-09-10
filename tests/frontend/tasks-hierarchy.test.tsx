// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";

import {
  buildHierarchy,
  TasksHierarchy,
} from "@/app/components/tasks/tasks-hierarchy";
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

function createTree(): WorkItemDetail[] {
  return [
    createWorkItem({
      id: "init-1",
      key: "PAGE-1",
      progressPercentage: 0,
      title: "Pages Plattform etablieren",
      type: WORK_ITEM_TYPE.INITIATIVE,
    }),
    createWorkItem({
      id: "epic-1",
      key: "PAGE-2",
      parentId: "init-1",
      progressPercentage: 0,
      title: "Projektverwaltung",
      type: WORK_ITEM_TYPE.EPIC,
    }),
    createWorkItem({
      id: "task-1",
      isDone: true,
      key: "PAGE-12",
      parentId: "epic-1",
      progressPercentage: 100,
      title: "Projekt erstellen",
    }),
    createWorkItem({
      id: "task-2",
      key: "PAGE-13",
      parentId: "epic-1",
      progressPercentage: 0,
      title: "Projekt bearbeiten",
    }),
    createWorkItem({
      id: "sub-1",
      key: "PAGE-14",
      parentId: "task-2",
      progressPercentage: 0,
      title: "Formular erstellen",
      type: WORK_ITEM_TYPE.SUBTASK,
    }),
  ];
}

function renderHierarchy(items: WorkItemDetail[]): {
  onSelectTask: ReturnType<typeof vi.fn>;
  onOpenTask: ReturnType<typeof vi.fn>;
} {
  const onSelectTask = vi.fn();
  const onOpenTask = vi.fn();
  const i18n = createI18n(LANGUAGE.GERMAN);

  render(
    <I18nextProvider i18n={i18n}>
      <TasksHierarchy
        onOpenTask={onOpenTask}
        onSelectTask={onSelectTask}
        selectedTaskId={null}
        workItems={items}
      />
    </I18nextProvider>,
  );

  return { onOpenTask, onSelectTask };
}

describe("buildHierarchy", () => {
  it("nests initiatives, epics, tasks, and subtasks with averaged progress", () => {
    const nodes = buildHierarchy(createTree());

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.item.key).toBe("PAGE-1");
    expect(nodes[0]?.children).toHaveLength(1);
    expect(nodes[0]?.progress).toBe(50);

    const epic = nodes[0]?.children[0];
    expect(epic?.children).toHaveLength(2);
    expect(epic?.progress).toBe(50);

    const task = epic?.children[1];
    expect(task?.children).toHaveLength(1);
    expect(task?.progress).toBe(0);
  });

  it("attaches orphaned items at the root", () => {
    const nodes = buildHierarchy([
      createWorkItem({ id: "orphan", parentId: "missing-parent" }),
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.item.id).toBe("orphan");
  });

  it("returns no nodes without work items", () => {
    expect(buildHierarchy([])).toEqual([]);
  });
});

describe("TasksHierarchy", () => {
  it("renders the full tree and selects tasks", async () => {
    const user = userEvent.setup();
    const { onSelectTask, onOpenTask } = renderHierarchy(createTree());

    expect(screen.getByText("Pages Plattform etablieren")).toBeInTheDocument();
    expect(screen.getByText("Projektverwaltung")).toBeInTheDocument();
    expect(screen.getByText("Projekt erstellen")).toBeInTheDocument();
    expect(screen.getByText("Formular erstellen")).toBeInTheDocument();

    await user.click(screen.getByText("Projekt bearbeiten"));

    expect(onSelectTask).toHaveBeenCalledWith("PAGE-13");

    await user.dblClick(screen.getByText("Projektverwaltung"));

    expect(onOpenTask).toHaveBeenCalledWith("PAGE-2");
  });

  it("collapses and expands hierarchy levels", async () => {
    const user = userEvent.setup();
    renderHierarchy(createTree());

    const toggle = screen.getByRole("button", {
      name: "PAGE-2 Projektverwaltung",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(screen.queryByText("Projekt erstellen")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText("Projekt erstellen")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Alle aufklappen" }));
    expect(screen.getByText("Projekt erstellen")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Alle zuklappen" }));
    expect(screen.queryByText("Projektverwaltung")).not.toBeInTheDocument();
    expect(screen.getByText("Pages Plattform etablieren")).toBeInTheDocument();
  });

  it("marks the selected task", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksHierarchy
          onOpenTask={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId="PAGE-12"
          workItems={createTree()}
        />
      </I18nextProvider>,
    );

    const row = screen.getByText("Projekt erstellen").closest("div");
    expect(row?.className).toContain("ring-primary");
  });

  it("shows every work item type label", () => {
    renderHierarchy(createTree());

    expect(screen.getAllByText("Initiative")).toHaveLength(2);
    expect(screen.getAllByText("Epic")).toHaveLength(2);
  });

  it("expands the root list when show more is clicked", async () => {
    const user = userEvent.setup();
    const items: WorkItemDetail[] = Array.from({ length: 60 }, (_, index) =>
      createWorkItem({
        id: `root-${index}`,
        key: `PAGE-${100 + index}`,
        parentId: null,
        parentKey: null,
        parentTitle: null,
        title: `Root ${index}`,
      }),
    );

    const initial = renderHierarchy(items);

    expect(screen.getAllByText(/^Root \d+$/)).toHaveLength(50);

    await user.click(screen.getByRole("button", { name: /weitere anzeigen/ }));

    expect(screen.getAllByText(/^Root \d+$/)).toHaveLength(60);

    void initial;
  });
});
