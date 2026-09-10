// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";

import { TasksMilestones } from "@/app/components/tasks/tasks-milestones";
import { createI18n } from "@/app/lib/i18n";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { Milestone, WorkItemDetail } from "@/definition/Task";

function createWorkItem(
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeId: null,
    assigneeName: null,
    reporterName: null,
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    description: "",
    dueAt: null,
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
    milestoneName: "MVP",
    number: 12,
    parentId: null,
    parentKey: null,
    parentTitle: null,
    priority: WORK_ITEM_PRIORITY.NORMAL,
    progressPercentage: 0,
    projectId: "project-1",
    projectName: "Pages",
    sortOrder: 1,
    startAt: null,
    statusId: "status-todo",
    statusKey: "todo",
    statusName: "To Do",
    subtaskCompleted: 0,
    subtaskTotal: 0,
    title: "Login",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function createMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    archivedAt: null,
    completedAt: null,
    createdAt: "2026-01-01",
    description: "First release",
    dueAt: "2026-09-30",
    id: "milestone-1",
    name: "MVP",
    projectId: "project-1",
    startAt: null,
    status: "open",
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

describe("TasksMilestones", () => {
  it("renders milestone progress computed from assigned tasks", async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    const onOpenTask = vi.fn();
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksMilestones
          milestones={[createMilestone()]}
          onOpenTask={onOpenTask}
          onSelectTask={onSelectTask}
          workItems={[
            createWorkItem(),
            createWorkItem({
              id: "item-2",
              isDone: true,
              key: "PAGE-13",
              title: "Dashboard",
            }),
          ]}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("MVP")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 Aufgaben")).toBeInTheDocument();

    await user.click(screen.getByText("Dashboard"));

    expect(onSelectTask).toHaveBeenCalledWith("PAGE-13");

    await user.dblClick(screen.getByText("Login"));

    expect(onOpenTask).toHaveBeenCalledWith("PAGE-12");
  });

  it("handles milestones without tasks, descriptions, or due dates", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksMilestones
          milestones={[
            createMilestone({
              description: "",
              dueAt: null,
              id: "milestone-2",
              name: "Future",
            }),
          ]}
          onOpenTask={vi.fn()}
          onSelectTask={vi.fn()}
          workItems={[]}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("Kein Zieldatum")).toBeInTheDocument();
    expect(screen.getByText("Keine Aufgaben zugeordnet.")).toBeInTheDocument();
  });

  it("renders an empty state without milestones", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksMilestones
          milestones={[]}
          onOpenTask={vi.fn()}
          onSelectTask={vi.fn()}
          workItems={[]}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("Noch keine Meilensteine.")).toBeInTheDocument();
  });

  it("shows the show-more button when a milestone has more than ten tasks", async () => {
    const user = userEvent.setup();
    const i18n = createI18n(LANGUAGE.GERMAN);
    const items: WorkItemDetail[] = Array.from({ length: 12 }, (_, index) =>
      createWorkItem({
        id: `task-${index}`,
        key: `PAGE-${100 + index}`,
        sortOrder: index + 1,
        title: `Task ${index}`,
      }),
    );

    render(
      <I18nextProvider i18n={i18n}>
        <TasksMilestones
          milestones={[createMilestone()]}
          onOpenTask={vi.fn()}
          onSelectTask={vi.fn()}
          workItems={items}
        />
      </I18nextProvider>,
    );

    expect(screen.getAllByText(/^Task \d+$/)).toHaveLength(10);

    const showMore = screen.getByRole("button", { name: /weitere anzeigen/ });

    await user.click(showMore);

    expect(screen.getAllByText(/^Task \d+$/)).toHaveLength(12);
  });
});
