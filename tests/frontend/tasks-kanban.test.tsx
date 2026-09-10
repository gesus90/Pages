// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";

import { TasksKanban } from "@/app/components/tasks/tasks-kanban";
import { createI18n } from "@/app/lib/i18n";
import {
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
  WORKFLOW_STATUS_KEY,
} from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";

function createStatuses(): WorkflowStatus[] {
  return [
    {
      id: "status-backlog",
      isDone: false,
      key: WORKFLOW_STATUS_KEY.BACKLOG,
      name: "Backlog",
      position: 1,
      projectId: null,
    },
    {
      id: "status-todo",
      isDone: false,
      key: WORKFLOW_STATUS_KEY.TODO,
      name: "To Do",
      position: 2,
      projectId: null,
    },
    {
      id: "status-in-progress",
      isDone: false,
      key: WORKFLOW_STATUS_KEY.IN_PROGRESS,
      name: "In Arbeit",
      position: 3,
      projectId: null,
    },
    {
      id: "status-review",
      isDone: false,
      key: WORKFLOW_STATUS_KEY.REVIEW,
      name: "Review",
      position: 4,
      projectId: null,
    },
    {
      id: "status-done",
      isDone: true,
      key: WORKFLOW_STATUS_KEY.DONE,
      name: "Done",
      position: 5,
      projectId: null,
    },
  ];
}

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
    description: "Build drag and drop",
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

function createDataTransfer(): {
  data: Record<string, string>;
  transfer: DataTransfer;
} {
  const data: Record<string, string> = {};
  const transfer = {
    data,
    getData(key: string): string {
      return data[key] ?? "";
    },
    setData(key: string, val: string): void {
      data[key] = val;
    },
  } as unknown as DataTransfer;

  return { data, transfer };
}

class FakeResizeObserver {
  private readonly callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(target: Element): void {
    const entry = {
      contentRect: target.getBoundingClientRect(),
      target,
    } as unknown as ResizeObserverEntry;

    this.callback([entry], this);
  }

  public unobserve(): void {}

  public disconnect(): void {}
}

function setViewportMetrics(
  element: HTMLElement,
  metrics: {
    readonly clientHeight: number;
    readonly scrollHeight: number;
    readonly scrollTop: number;
  },
): void {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    value: metrics.scrollTop,
    writable: true,
  });
}

describe("TasksKanban", () => {
  it("renders all five workflow columns and card details", async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    const onOpenTask = vi.fn();
    const onQuickCreate = vi.fn();
    const onMoveTask = vi.fn();

    const i18n = createI18n(LANGUAGE.GERMAN);
    render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
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
          onMoveTask={onMoveTask}
          onOpenTask={onOpenTask}
          onQuickCreate={onQuickCreate}
          onSelectTask={onSelectTask}
          selectedTaskId="item-1"
          statuses={createStatuses()}
          workItems={[
            createWorkItem(),
            createWorkItem({
              githubIssueNumber: 42,
              id: "item-2",
              key: "ASTRO-31",
              projectName: "AstroLab",
              statusId: "status-in-progress",
              title: "MCP repair",
            }),
            createWorkItem({
              assigneeName: null,
              reporterName: null,
              description: "",
              id: "item-3",
              key: "ANI-1",
              projectName: "Animus",
              statusId: "status-done",
              subtaskTotal: 0,
              title: "Clean Item",
            }),
          ]}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("To Do")).toBeInTheDocument();
    expect(screen.getByText("In Arbeit")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();

    expect(screen.getByText("PAGE-12")).toBeInTheDocument();
    expect(screen.getByText("Kanban implementieren")).toBeInTheDocument();
    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByText("ASTRO-31")).toBeInTheDocument();
    expect(screen.getByText("AstroLab")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();

    await user.click(screen.getByText("Kanban implementieren"));
    expect(onSelectTask).toHaveBeenCalledWith("PAGE-12");

    await user.dblClick(screen.getByText("MCP repair"));
    expect(onOpenTask).toHaveBeenCalledWith("ASTRO-31");

    const quickCreateButtons = screen.getAllByRole("button", {
      name: /Neue Aufgabe \(/,
    });
    await user.click(quickCreateButtons[0] as HTMLElement);
    expect(onQuickCreate).toHaveBeenCalledWith("status-backlog");
  });

  it("handles HTML5 drag and drop between columns", () => {
    const onMoveTask = vi.fn();
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
          onMoveTask={onMoveTask}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={[
            createWorkItem(),
            createWorkItem({
              id: "item-9",
              key: "PAGE-13",
              statusId: "status-in-progress",
              title: "Already in progress",
            }),
          ]}
        />
      </I18nextProvider>,
    );

    const card = screen.getByText("Kanban implementieren").closest("article")!;
    const inProgressColumn = screen.getByText("In Arbeit").closest(".w-80")!;
    const backlogColumn = screen.getByText("Backlog").closest(".w-80")!;

    const { transfer } = createDataTransfer();

    fireEvent.drop(inProgressColumn, {
      dataTransfer: {
        ...transfer,
        getData() {
          return "";
        },
      } as unknown as DataTransfer,
    });

    fireEvent.dragStart(card, { dataTransfer: transfer });
    expect(transfer.getData("text/plain")).toBe("item-1");

    fireEvent.dragOver(backlogColumn, { dataTransfer: transfer });
    fireEvent.dragOver(inProgressColumn, { dataTransfer: transfer });
    fireEvent.dragOver(inProgressColumn, { dataTransfer: transfer });
    const backlogBodyLeave = new Event("dragleave", { bubbles: true });
    Object.defineProperty(backlogBodyLeave, "relatedTarget", {
      configurable: true,
      value: document.body,
    });
    backlogColumn.dispatchEvent(backlogBodyLeave);
    const childNode = inProgressColumn.querySelector("h3")!;
    const childLeave = new Event("dragleave", { bubbles: true });
    Object.defineProperty(childLeave, "relatedTarget", {
      configurable: true,
      value: childNode,
    });
    inProgressColumn.dispatchEvent(childLeave);
    const bodyLeave = new Event("dragleave", { bubbles: true });
    Object.defineProperty(bodyLeave, "relatedTarget", {
      configurable: true,
      value: document.body,
    });
    inProgressColumn.dispatchEvent(bodyLeave);
    fireEvent.drop(inProgressColumn, { dataTransfer: transfer });

    expect(onMoveTask).toHaveBeenCalledWith("item-1", "status-in-progress", 2);
  });

  it("renders the show-more button when a column exceeds the page size", async () => {
    const user = userEvent.setup();
    const items: WorkItemDetail[] = Array.from({ length: 55 }, (_, index) =>
      createWorkItem({
        id: `ticket-${index}`,
        key: `PAGE-${100 + index}`,
        sortOrder: index + 1,
        statusId: "status-todo",
        title: `Ticket ${index}`,
      }),
    );

    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
          onMoveTask={vi.fn()}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={items}
        />
      </I18nextProvider>,
    );

    expect(screen.getAllByText(/^Ticket \d+$/)).toHaveLength(50);

    const showMore = screen.getByRole("button", { name: /weitere anzeigen/ });

    await user.click(showMore);

    expect(screen.getAllByText(/^Ticket \d+$/)).toHaveLength(55);
  });

  it("renders the ghost preview during an active drag", () => {
    const onMoveTask = vi.fn();
    const i18n = createI18n(LANGUAGE.GERMAN);

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
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
              {
                color: "#22c55e",
                createdAt: "2026-01-01",
                id: "label-2",
                name: "Backend",
                projectId: "project-1",
                updatedAt: "2026-01-02",
              },
              {
                color: "#a855f7",
                createdAt: "2026-01-01",
                id: "label-3",
                name: "Frontend",
                projectId: "project-1",
                updatedAt: "2026-01-02",
              },
              {
                color: "#ef4444",
                createdAt: "2026-01-01",
                id: "label-4",
                name: "Extra",
                projectId: "project-1",
                updatedAt: "2026-01-02",
              },
            ],
          }}
          onMoveTask={onMoveTask}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={[
            createWorkItem({ assigneeName: null }),
            createWorkItem({
              assigneeName: null,
              id: "item-2",
              key: "ASTRO-31",
              milestoneId: null,
              milestoneName: null,
              priority: WORK_ITEM_PRIORITY.LOW,
              statusId: "status-backlog",
              type: WORK_ITEM_TYPE.SUBTASK,
            }),
            createWorkItem({
              id: "item-3",
              key: "ANI-1",
              milestoneId: null,
              milestoneName: null,
              priority: WORK_ITEM_PRIORITY.URGENT,
              statusId: "status-in-progress",
              type: WORK_ITEM_TYPE.INITIATIVE,
            }),
            createWorkItem({
              id: "item-4",
              key: "ANI-2",
              milestoneId: null,
              milestoneName: null,
              statusId: "status-review",
              type: WORK_ITEM_TYPE.EPIC,
            }),
          ]}
        />
      </I18nextProvider>,
    );

    const cards = screen.getAllByText("Kanban implementieren");
    const card = cards[0]?.closest("article");

    if (!card) {
      return;
    }

    const { transfer } = createDataTransfer();

    fireEvent.dragStart(card, { dataTransfer: transfer });

    const todoColumn = screen.getByText("To Do").closest(".w-80")!;

    fireEvent.dragOver(todoColumn, { dataTransfer: transfer });

    expect(container.querySelector("[data-drop-ghost]")).not.toBeNull();

    fireEvent.dragEnd(card);

    expect(container.querySelector("[data-drop-ghost]")).toBeNull();
  });

  it("does not show the ghost when dragOver fires without a draggedTaskId", () => {
    const onMoveTask = vi.fn();
    const i18n = createI18n(LANGUAGE.GERMAN);

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
          onMoveTask={onMoveTask}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={[
            createWorkItem(),
            createWorkItem({
              id: "item-2",
              key: "ASTRO-31",
              milestoneId: null,
              milestoneName: null,
              statusId: "status-in-progress",
              title: "Already in progress",
            }),
          ]}
        />
      </I18nextProvider>,
    );

    const todoColumn = screen.getByText("To Do").closest(".w-80")!;

    const { transfer } = createDataTransfer();

    fireEvent.dragOver(todoColumn, { dataTransfer: transfer });

    expect(container.querySelector("[data-drop-ghost]")).toBeNull();
  });

  it("renders all four type variants with the matching labels", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
          onMoveTask={vi.fn()}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={[
            createWorkItem({ assigneeName: null }),
            createWorkItem({
              assigneeName: null,
              id: "item-2",
              key: "ASTRO-31",
              milestoneId: null,
              milestoneName: null,
              priority: WORK_ITEM_PRIORITY.LOW,
              statusId: "status-backlog",
              type: WORK_ITEM_TYPE.SUBTASK,
            }),
            createWorkItem({
              id: "item-3",
              key: "ANI-1",
              milestoneId: null,
              milestoneName: null,
              priority: WORK_ITEM_PRIORITY.URGENT,
              statusId: "status-in-progress",
              type: WORK_ITEM_TYPE.INITIATIVE,
            }),
            createWorkItem({
              id: "item-4",
              key: "ANI-2",
              milestoneId: null,
              milestoneName: null,
              priority: WORK_ITEM_PRIORITY.HIGH,
              statusId: "status-review",
              type: WORK_ITEM_TYPE.EPIC,
            }),
          ]}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("Initiative")).toBeInTheDocument();
    expect(screen.getByText("Epic")).toBeInTheDocument();
    expect(screen.getByText("Subtask")).toBeInTheDocument();
  });

  it("shows the ghost with high and low priority labels", () => {
    const onMoveTask = vi.fn();
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
          onMoveTask={onMoveTask}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={[
            createWorkItem(),
            createWorkItem({
              assigneeName: null,
              id: "item-high",
              key: "PAGE-21",
              milestoneId: null,
              milestoneName: null,
              priority: WORK_ITEM_PRIORITY.HIGH,
              statusId: "status-review",
              title: "High priority",
            }),
            createWorkItem({
              assigneeName: null,
              id: "item-low",
              key: "PAGE-22",
              milestoneId: null,
              milestoneName: null,
              priority: WORK_ITEM_PRIORITY.LOW,
              statusId: "status-done",
              title: "Low priority",
            }),
          ]}
        />
      </I18nextProvider>,
    );

    const cards = screen.getAllByText("Kanban implementieren");
    const card = cards[0]?.closest("article");

    if (!card) {
      return;
    }

    const { transfer } = createDataTransfer();

    fireEvent.dragStart(card, { dataTransfer: transfer });

    const todoColumn = screen.getByText("To Do").closest(".w-80")!;

    fireEvent.dragOver(todoColumn, { dataTransfer: transfer });

    expect(screen.getAllByText("Hoch").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Niedrig").length).toBeGreaterThan(0);
  });

  it("renders the show-more button for backlog column", async () => {
    const user = userEvent.setup();
    const items: WorkItemDetail[] = Array.from({ length: 60 }, (_, index) =>
      createWorkItem({
        id: `backlog-${index}`,
        key: `PAGE-${100 + index}`,
        sortOrder: index + 1,
        statusId: "status-backlog",
        title: `Backlog ${index}`,
      }),
    );

    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
          onMoveTask={vi.fn()}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={items}
        />
      </I18nextProvider>,
    );

    expect(screen.getAllByText(/^Backlog \d+$/)).toHaveLength(50);

    const showMore = screen.getByRole("button", { name: /weitere anzeigen/ });

    await user.click(showMore);

    expect(screen.getAllByText(/^Backlog \d+$/)).toHaveLength(60);
  });

  it("emits a move when dropping at the end of a column", () => {
    const onMoveTask = vi.fn();
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
          onMoveTask={onMoveTask}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={[
            createWorkItem(),
            createWorkItem({
              id: "item-2",
              key: "ASTRO-31",
              statusId: "status-in-progress",
              title: "Already in progress",
            }),
          ]}
        />
      </I18nextProvider>,
    );

    const card = screen.getByText("Kanban implementieren").closest("article")!;
    const backlogColumn = screen.getByText("Backlog").closest(".w-80")!;

    const { transfer } = createDataTransfer();

    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.dragOver(backlogColumn, {
      clientY: 9999,
      dataTransfer: transfer,
    });
    fireEvent.drop(backlogColumn, {
      clientY: 9999,
      dataTransfer: transfer,
    });

    expect(onMoveTask).toHaveBeenCalled();
  });

  it("triggers a move when a card is dropped from a different column", () => {
    const onMoveTask = vi.fn();
    const i18n = createI18n(LANGUAGE.GERMAN);

    render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
          onMoveTask={onMoveTask}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={[
            createWorkItem(),
            createWorkItem({
              id: "item-2",
              key: "ASTRO-31",
              statusId: "status-in-progress",
              title: "Already in progress",
            }),
          ]}
        />
      </I18nextProvider>,
    );

    const card = screen.getByText("Kanban implementieren").closest("article")!;
    const inProgressColumn = screen.getByText("In Arbeit").closest(".w-80")!;

    const { transfer } = createDataTransfer();

    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.dragOver(inProgressColumn, { dataTransfer: transfer });
    fireEvent.drop(inProgressColumn, {
      clientY: 0,
      dataTransfer: transfer,
    });

    expect(onMoveTask).toHaveBeenCalledWith(
      "item-1",
      "status-in-progress",
      expect.any(Number),
    );
  });

  it("toggles the ticket viewport fades based on vertical scroll position", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    const { container, unmount } = render(
      <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
        <TasksKanban
          onMoveTask={vi.fn()}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={[createWorkItem()]}
        />
      </I18nextProvider>,
    );

    const todoColumn = screen
      .getByText("To Do")
      .closest(".w-80") as HTMLElement;
    const viewport = todoColumn.querySelector(
      ".pages-hover-scrollbar",
    ) as HTMLElement;
    const topFade = todoColumn.querySelector(
      ".pages-scroll-fade-top",
    ) as HTMLElement;
    const bottomFade = todoColumn.querySelector(
      ".pages-scroll-fade-bottom",
    ) as HTMLElement;

    setViewportMetrics(viewport, {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 0,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(topFade.className).not.toContain("fadeVisible");
    expect(bottomFade.className).toContain("fadeVisible");

    setViewportMetrics(viewport, {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 400,
    });

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(topFade.className).toContain("fadeVisible");
    expect(bottomFade.className).not.toContain("fadeVisible");

    act(() => {
      unmount();
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("renders ghost type, priority, and label details for every work item kind", () => {
    const onMoveTask = vi.fn();
    const i18n = createI18n(LANGUAGE.GERMAN);

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
          labelsByWorkItem={{
            "item-task": [
              {
                color: "#3b82f6",
                createdAt: "2026-01-01",
                id: "label-1",
                name: "Feature",
                projectId: "project-1",
                updatedAt: "2026-01-02",
              },
              {
                color: "#22c55e",
                createdAt: "2026-01-01",
                id: "label-2",
                name: "Backend",
                projectId: "project-1",
                updatedAt: "2026-01-02",
              },
              {
                color: "#a855f7",
                createdAt: "2026-01-01",
                id: "label-3",
                name: "Frontend",
                projectId: "project-1",
                updatedAt: "2026-01-02",
              },
              {
                color: "#ef4444",
                createdAt: "2026-01-01",
                id: "label-4",
                name: "Extra",
                projectId: "project-1",
                updatedAt: "2026-01-02",
              },
            ],
            "item-init": [
              {
                color: "#3b82f6",
                createdAt: "2026-01-01",
                id: "label-5",
                name: "Design",
                projectId: "project-1",
                updatedAt: "2026-01-02",
              },
              {
                color: "#22c55e",
                createdAt: "2026-01-01",
                id: "label-6",
                name: "Infra",
                projectId: "project-1",
                updatedAt: "2026-01-02",
              },
            ],
          }}
          onMoveTask={onMoveTask}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={[
            createWorkItem({
              id: "item-task",
              key: "TASK-1",
              priority: WORK_ITEM_PRIORITY.NORMAL,
              statusId: "status-todo",
              title: "Base task",
            }),
            createWorkItem({
              id: "item-init",
              key: "INI-1",
              priority: WORK_ITEM_PRIORITY.URGENT,
              statusId: "status-in-progress",
              subtaskCompleted: 0,
              subtaskTotal: 0,
              title: "Initiative one",
              type: WORK_ITEM_TYPE.INITIATIVE,
            }),
            createWorkItem({
              githubIssueNumber: 42,
              id: "item-epic",
              key: "EPIC-1",
              statusId: "status-review",
              title: "Epic one",
              type: WORK_ITEM_TYPE.EPIC,
            }),
          ]}
        />
      </I18nextProvider>,
    );

    const { transfer } = createDataTransfer();

    const taskCard = screen
      .getByText("TASK-1")
      .closest("article") as HTMLElement;
    fireEvent.dragStart(taskCard, { dataTransfer: transfer });

    const todoColumn = screen
      .getByText("To Do")
      .closest(".w-80") as HTMLElement;
    fireEvent.dragOver(todoColumn, { dataTransfer: transfer });

    const taskGhost = container.querySelector("[data-drop-ghost]");
    expect(taskGhost).not.toBeNull();
    expect(taskGhost?.textContent).toContain("Feature");
    expect(taskGhost?.textContent).toContain("Backend");
    expect(taskGhost?.textContent).toContain("Frontend");
    expect(taskGhost?.textContent).toContain("+1");

    fireEvent.dragEnd(taskCard);

    const initCard = screen
      .getByText("INI-1")
      .closest("article") as HTMLElement;
    fireEvent.dragStart(initCard, { dataTransfer: transfer });

    const inProgressColumn = screen
      .getByText("In Arbeit")
      .closest(".w-80") as HTMLElement;
    fireEvent.dragOver(inProgressColumn, { dataTransfer: transfer });

    const initGhost = container.querySelector("[data-drop-ghost]");
    expect(initGhost).not.toBeNull();
    expect(initGhost?.textContent).toContain("Initiative");
    expect(initGhost?.textContent).toContain("Dringend");
    expect(initGhost?.textContent).toContain("Design");
    expect(initGhost?.textContent).toContain("Infra");
    expect(initGhost?.textContent).not.toContain("+1");
    expect(initGhost?.textContent).not.toContain("/");

    fireEvent.dragEnd(initCard);

    const epicCard = screen
      .getByText("EPIC-1")
      .closest("article") as HTMLElement;
    fireEvent.dragStart(epicCard, { dataTransfer: transfer });

    const reviewColumn = screen
      .getByText("Review")
      .closest(".w-80") as HTMLElement;
    fireEvent.dragOver(reviewColumn, { dataTransfer: transfer });

    const epicGhost = container.querySelector("[data-drop-ghost]");
    expect(epicGhost).not.toBeNull();
    expect(epicGhost?.textContent).toContain("Epic");
    expect(epicGhost?.textContent).toContain("Hoch");
    expect(epicGhost?.querySelector(".size-2")).not.toBeNull();
  });

  it("inserts the ghost before a card and drops it below the dragged card", () => {
    const onMoveTask = vi.fn();
    const i18n = createI18n(LANGUAGE.GERMAN);

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <TasksKanban
          onMoveTask={onMoveTask}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={[
            createWorkItem(),
            createWorkItem({
              id: "item-2",
              key: "ASTRO-31",
              statusId: "status-todo",
              title: "Second card",
            }),
          ]}
        />
      </I18nextProvider>,
    );

    const firstCard = screen
      .getByText("PAGE-12")
      .closest("article") as HTMLElement;
    const secondCard = screen
      .getByText("ASTRO-31")
      .closest("article") as HTMLElement;
    const todoColumn = screen
      .getByText("To Do")
      .closest(".w-80") as HTMLElement;

    const cardRect = (top: number): DOMRect =>
      ({
        bottom: top + 40,
        height: 40,
        left: 0,
        right: 0,
        toJSON: () => ({}),
        top,
        width: 320,
        x: 0,
        y: top,
      }) as DOMRect;

    vi.spyOn(firstCard, "getBoundingClientRect").mockReturnValue(cardRect(100));
    vi.spyOn(secondCard, "getBoundingClientRect").mockReturnValue(
      cardRect(200),
    );

    const { transfer } = createDataTransfer();

    fireEvent.dragStart(firstCard, { dataTransfer: transfer });

    const dragover = new MouseEvent("dragover", {
      bubbles: true,
      cancelable: true,
      clientY: 150,
    });
    Object.defineProperty(dragover, "dataTransfer", {
      configurable: true,
      value: transfer,
    });
    act(() => {
      todoColumn.dispatchEvent(dragover);
    });

    const ghost = container.querySelector("[data-drop-ghost]");
    expect(ghost).not.toBeNull();

    vi.spyOn(ghost as HTMLElement, "getBoundingClientRect").mockReturnValue(
      cardRect(160),
    );

    const drop = new MouseEvent("drop", {
      bubbles: true,
      cancelable: true,
      clientY: 150,
    });
    Object.defineProperty(drop, "dataTransfer", {
      configurable: true,
      value: transfer,
    });
    act(() => {
      todoColumn.dispatchEvent(drop);
    });

    expect(onMoveTask).toHaveBeenCalledWith("item-1", "status-todo", 1);

    fireEvent.dragStart(secondCard, { dataTransfer: transfer });

    const dragoverAbove = new MouseEvent("dragover", {
      bubbles: true,
      cancelable: true,
      clientY: 50,
    });
    Object.defineProperty(dragoverAbove, "dataTransfer", {
      configurable: true,
      value: transfer,
    });
    act(() => {
      todoColumn.dispatchEvent(dragoverAbove);
    });

    const ghostAbove = container.querySelector("[data-drop-ghost]");
    expect(ghostAbove).not.toBeNull();

    vi.spyOn(
      ghostAbove as HTMLElement,
      "getBoundingClientRect",
    ).mockReturnValue(cardRect(60));

    const dropAbove = new MouseEvent("drop", {
      bubbles: true,
      cancelable: true,
      clientY: 50,
    });
    Object.defineProperty(dropAbove, "dataTransfer", {
      configurable: true,
      value: transfer,
    });
    act(() => {
      todoColumn.dispatchEvent(dropAbove);
    });

    expect(onMoveTask).toHaveBeenCalledWith("item-2", "status-todo", 1);
  });

  it("keeps the board stable when the dragged item disappears from the board", () => {
    const onMoveTask = vi.fn();
    const i18n = createI18n(LANGUAGE.GERMAN);

    const view = (items: readonly WorkItemDetail[]): React.ReactElement => (
      <I18nextProvider i18n={i18n}>
        <TasksKanban
          onMoveTask={onMoveTask}
          onOpenTask={vi.fn()}
          onQuickCreate={vi.fn()}
          onSelectTask={vi.fn()}
          selectedTaskId={null}
          statuses={createStatuses()}
          workItems={items}
        />
      </I18nextProvider>
    );

    const { container, rerender } = render(
      view([
        createWorkItem(),
        createWorkItem({
          id: "item-2",
          key: "ASTRO-31",
          statusId: "status-todo",
          title: "Second card",
        }),
      ]),
    );

    const firstCard = screen
      .getByText("PAGE-12")
      .closest("article") as HTMLElement;
    const todoColumn = screen
      .getByText("To Do")
      .closest(".w-80") as HTMLElement;

    const { transfer } = createDataTransfer();

    fireEvent.dragStart(firstCard, { dataTransfer: transfer });

    rerender(
      view([
        createWorkItem({
          id: "item-2",
          key: "ASTRO-31",
          statusId: "status-todo",
          title: "Second card",
        }),
      ]),
    );

    fireEvent.dragOver(todoColumn, { dataTransfer: transfer });

    expect(container.querySelector("[data-drop-ghost]")).toBeNull();
  });
});
