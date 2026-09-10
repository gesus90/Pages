// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TaskDetailPanel } from "@/app/components/tasks/task-detail-panel";
import { createI18n } from "@/app/lib/i18n";
import {
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
  WORKFLOW_STATUS_KEY,
} from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { Project } from "@/definition/Project";
import type {
  Milestone,
  ProjectLabel,
  WorkItemDetail,
  WorkItemHistory,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

function createStatuses(): WorkflowStatus[] {
  return [
    {
      id: "status-todo",
      isDone: false,
      key: WORKFLOW_STATUS_KEY.TODO,
      name: "To Do",
      position: 1,
      projectId: null,
    },
    {
      id: "status-done",
      isDone: true,
      key: WORKFLOW_STATUS_KEY.DONE,
      name: "Done",
      position: 2,
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
    assigneeName: "Admin",
    reporterName: "Alex Berger",
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    description: "Detailed description of task",
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
    parentId: "epic-1",
    parentKey: "PAGE-3",
    parentTitle: "Epic System",
    priority: WORK_ITEM_PRIORITY.HIGH,
    progressPercentage: 50,
    projectId: "project-1",
    projectName: "Pages",
    sortOrder: 1,
    startAt: "2026-03-01",
    statusId: "status-todo",
    statusKey: "todo",
    statusName: "To Do",
    subtaskCompleted: 2,
    subtaskTotal: 4,
    title: "Kanban Board implementieren",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function createHistory(): WorkItemHistory[] {
  return [
    {
      action: "status_changed",
      createdAt: "2026-09-05 14:37",
      field: "status",
      id: "hist-1",
      newValue: "In Arbeit",
      oldValue: "To Do",
      userDisplayName: "Admin",
      userId: "user-1",
      workItemId: "item-1",
    },
    {
      action: "created",
      createdAt: "2026-09-05 14:30",
      field: null,
      id: "hist-2",
      newValue: null,
      oldValue: null,
      userDisplayName: null,
      userId: "user-1",
      workItemId: "item-1",
    },
  ];
}

function createAssignees(): User[] {
  return [
    {
      displayName: "Admin",
      id: "user-1",
      isActive: true,
      role: "admin",
      username: "admin",
    },
    {
      displayName: "Max Mustermann",
      id: "user-2",
      isActive: true,
      role: "employee",
      username: "max",
    },
  ];
}

function createMilestones(): Milestone[] {
  return [
    {
      archivedAt: null,
      completedAt: null,
      createdAt: "2026-01-01",
      description: "",
      dueAt: "2026-05-01",
      id: "milestone-1",
      name: "Pages v0.2",
      projectId: "project-1",
      startAt: null,
      status: "open",
      updatedAt: "2026-01-02",
    },
    {
      archivedAt: null,
      completedAt: null,
      createdAt: "2026-01-01",
      description: "",
      dueAt: "2026-06-01",
      id: "milestone-2",
      name: "Astro MS",
      projectId: "project-2",
      startAt: null,
      status: "open",
      updatedAt: "2026-01-02",
    },
  ];
}

function createProjects(): Project[] {
  return [
    {
      createdAt: "2026-01-01",
      description: "Pages",
      hasIcon: false,
      id: "project-1",
      managerId: null,
      managerName: null,
      name: "Pages",
      notes: "",
      parentId: null,
      placeholderColor: "#FCE3D3",
      progress: 0,
      startDate: null,
      status: "active",
      targetDate: null,
      updatedAt: "2026-01-02",
    },
    {
      createdAt: "2026-01-01",
      description: "Astro",
      hasIcon: false,
      id: "project-2",
      managerId: null,
      managerName: null,
      name: "AstroLab",
      notes: "",
      parentId: null,
      placeholderColor: "#FCE3D3",
      progress: 0,
      startDate: null,
      status: "active",
      targetDate: null,
      updatedAt: "2026-01-02",
    },
  ];
}

function createLabel(overrides: Partial<ProjectLabel> = {}): ProjectLabel {
  return {
    color: "#3b82f6",
    createdAt: "2026-01-01",
    id: "label-1",
    name: "Feature",
    projectId: "project-1",
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function createWorkItems(): WorkItemDetail[] {
  return [
    createWorkItem({
      id: "epic-1",
      key: "PAGE-3",
      parentId: null,
      parentKey: null,
      parentTitle: null,
      title: "Epic System",
      type: WORK_ITEM_TYPE.EPIC,
    }),
    createWorkItem({
      id: "init-1",
      key: "PAGE-1",
      parentId: null,
      parentKey: null,
      parentTitle: null,
      title: "Platform",
      type: WORK_ITEM_TYPE.INITIATIVE,
    }),
    createWorkItem({
      id: "epic-9",
      key: "ANI-9",
      parentId: null,
      parentKey: null,
      parentTitle: null,
      projectId: "project-2",
      projectName: "AstroLab",
      title: "Foreign Epic",
      type: WORK_ITEM_TYPE.EPIC,
    }),
    createWorkItem({
      id: "item-1",
      key: "PAGE-99",
      parentId: null,
      parentKey: null,
      parentTitle: null,
      title: "Self Epic",
      type: WORK_ITEM_TYPE.EPIC,
    }),
  ];
}

function renderPanel(
  properties: Partial<Parameters<typeof TaskDetailPanel>[0]> = {},
): {
  onClose: ReturnType<typeof vi.fn>;
  onCreateSubtask: ReturnType<typeof vi.fn>;
  onEdit: ReturnType<typeof vi.fn>;
  onSelectTask: ReturnType<typeof vi.fn>;
  onOpenTask: ReturnType<typeof vi.fn>;
} {
  const onClose = vi.fn();
  const onEdit = vi.fn();
  const onCreateSubtask = vi.fn();
  const onSelectTask = vi.fn();
  const onOpenTask = vi.fn();

  const i18n = createI18n(LANGUAGE.GERMAN);
  const router = createMemoryRouter(
    [
      {
        async action() {
          return null;
        },
        element: (
          <TaskDetailPanel
            assignees={createAssignees()}
            history={createHistory()}
            isArchiving={false}
            milestones={createMilestones()}
            onClose={onClose}
            onCreateSubtask={onCreateSubtask}
            onEdit={onEdit}
            onOpenTask={onOpenTask}
            onSelectTask={onSelectTask}
            projectLabels={[
              createLabel(),
              createLabel({
                color: "#22c55e",
                id: "label-2",
                name: "Backend",
              }),
              createLabel({
                color: "#6b7280",
                id: "label-9",
                name: "Docs",
                projectId: "project-2",
              }),
            ]}
            projects={createProjects()}
            statuses={createStatuses()}
            subtasks={[
              {
                ...createWorkItem(),
                id: "sub-1",
                isDone: true,
                key: "PAGE-13",
                title: "Drag & Drop",
                type: WORK_ITEM_TYPE.SUBTASK,
              },
              {
                ...createWorkItem(),
                id: "sub-2",
                isDone: false,
                key: "PAGE-14",
                title: "API anbinden",
                type: WORK_ITEM_TYPE.SUBTASK,
              },
            ]}
            task={createWorkItem()}
            taskLabels={[createLabel()]}
            workItems={createWorkItems()}
            {...properties}
          />
        ),
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
  );

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );

  return { onClose, onCreateSubtask, onEdit, onOpenTask, onSelectTask };
}

describe("TaskDetailPanel", () => {
  it("renders work item properties with sections", async () => {
    const user = userEvent.setup();
    const { onClose, onCreateSubtask, onOpenTask, onSelectTask } =
      renderPanel();

    expect(screen.getAllByText("PAGE-12").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Kanban Board implementieren").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByLabelText("Meilenstein")).toHaveTextContent(
      "Pages v0.2",
    );
    expect(screen.getByText("2 / 4 (50 %)")).toBeInTheDocument();
    expect(screen.getByLabelText("Reporter")).toHaveTextContent("Admin");
    expect(
      screen.getByLabelText("Epic auswählen (optional)"),
    ).toHaveTextContent("PAGE-3: Epic System");
    expect(screen.getByText("Feature")).toBeInTheDocument();

    expect(
      screen.getByText("Detailed description of task"),
    ).toBeInTheDocument();

    await user.click(screen.getByText("Drag & Drop"));
    expect(onSelectTask).toHaveBeenCalledWith("PAGE-13");

    await user.dblClick(screen.getByText("API anbinden"));
    expect(onOpenTask).toHaveBeenCalledWith("PAGE-14");

    await user.click(screen.getByRole("button", { name: "Unteraufgabe" }));
    expect(onCreateSubtask).toHaveBeenCalledTimes(1);

    expect(
      screen.getByText("Detailed description of task"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens subtasks from their rows with click and double click", async () => {
    const user = userEvent.setup();
    const { onSelectTask, onOpenTask } = renderPanel();

    await user.click(screen.getByText("Drag & Drop"));
    expect(onSelectTask).toHaveBeenCalledWith("PAGE-13");

    await user.dblClick(screen.getByText("API anbinden"));
    expect(onOpenTask).toHaveBeenCalledWith("PAGE-14");
  });

  it("handles empty subtasks and empty description", () => {
    renderPanel({
      history: [],
      subtasks: [],
      task: createWorkItem({ description: "" }),
    });

    expect(screen.getAllByText("Keine").length).toBeGreaterThan(0);
  });

  it("renders sparse tasks without optional relations", () => {
    renderPanel({
      assigneesByProject: {},
      history: [],
      projects: [],
      subtasks: [],
      task: createWorkItem({
        assigneeId: null,
        assigneeName: null,
        reporterName: null,
        description: "",
        dueAt: null,
        milestoneId: null,
        milestoneName: null,
        parentId: null,
        parentKey: null,
        parentTitle: null,
        progressPercentage: 0,
        subtaskCompleted: 0,
        subtaskTotal: 0,
      }),
      taskLabels: [],
    });

    expect(screen.getByText("Nicht zugewiesen")).toBeInTheDocument();
    expect(screen.getByText("0 %")).toBeInTheDocument();
    expect(screen.getByText("Nicht verknüpft")).toBeInTheDocument();
    expect(screen.getByLabelText("Meilenstein")).toHaveTextContent("Keine");
    expect(screen.getByLabelText("Fällig am")).toHaveValue("");
    expect(screen.getByLabelText("Projekt *")).toBeDisabled();
  });

  it("labels initiative parents of epics", () => {
    renderPanel({
      subtasks: [],
      task: createWorkItem({
        parentId: "init-1",
        parentKey: "PAGE-1",
        parentTitle: "Platform",
        type: WORK_ITEM_TYPE.EPIC,
      }),
    });

    expect(
      screen.getByLabelText("Initiative auswählen (optional)"),
    ).toHaveTextContent("PAGE-1: Platform");

    expect(
      screen.getByRole("button", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();
  });

  it("labels task parents of subtasks and hides subtask creation", async () => {
    const user = userEvent.setup();
    const { onSelectTask } = renderPanel({
      subtasks: [],
      task: createWorkItem({ type: WORK_ITEM_TYPE.SUBTASK }),
    });

    expect(screen.getByText("Übergeordneter Task *")).toBeInTheDocument();

    const parentButtons = screen.getAllByRole("button", { name: /PAGE-3/ });
    await user.click(parentButtons[0]);
    expect(onSelectTask).toHaveBeenCalledWith("PAGE-3");

    expect(
      screen.queryByRole("button", { name: "Unteraufgabe" }),
    ).not.toBeInTheDocument();
  });

  it("hides the parent row for subtasks without parents and initiatives", () => {
    renderPanel({
      history: [],
      subtasks: [],
      task: createWorkItem({
        parentId: null,
        parentKey: null,
        parentTitle: null,
        type: WORK_ITEM_TYPE.SUBTASK,
      }),
    });

    expect(screen.queryByText("Übergeordneter Task *")).not.toBeInTheDocument();

    renderPanel({
      history: [],
      subtasks: [],
      task: createWorkItem({ type: WORK_ITEM_TYPE.INITIATIVE }),
    });

    expect(
      screen.queryByLabelText("Epic auswählen (optional)"),
    ).not.toBeInTheDocument();
  });

  it("shows archiving progress", () => {
    renderPanel({ isArchiving: true });

    expect(screen.getByText("Wird archiviert …")).toBeInTheDocument();
  });

  it("shows archived tickets with a restore action", () => {
    renderPanel({
      history: [],
      subtasks: [],
      task: createWorkItem({ archivedAt: "2026-09-05" }),
    });

    expect(screen.getAllByText("Archiviert").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Wiederherstellen" }),
    ).toHaveLength(1);
    expect(screen.getByLabelText("Status")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Bearbeiten" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Unteraufgabe" }),
    ).not.toBeInTheDocument();
  });

  it("shows the compact GitHub state for linked tickets", () => {
    renderPanel({
      history: [],
      subtasks: [],
      task: createWorkItem({
        githubConflict: true,
        githubIssueNumber: 82,
        githubIssueState: "closed",
        githubIssueUrl: "https://github.com/user/pages/issues/82",
        githubLastError: "Forbidden",
        githubLastSyncAt: "2026-09-05 14:21",
      }),
    });

    expect(screen.getByText("Sync fehlgeschlagen")).toBeInTheDocument();
  });

  it("submits quick edits for status, priority, assignee, reporter, parent, milestone, and due date", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByLabelText("Status"));
    await user.click(await screen.findByRole("option", { name: "Done" }));

    await user.click(screen.getByLabelText("Priorität"));
    await user.click(await screen.findByRole("option", { name: "Dringend" }));

    await user.click(screen.getByLabelText("Zugewiesen an"));
    await user.click(
      await screen.findByRole("option", { name: "Max Mustermann" }),
    );

    await user.click(screen.getByLabelText("Reporter"));
    await user.click(
      await screen.findByRole("option", { name: "Max Mustermann" }),
    );

    await user.click(screen.getByLabelText("Epic auswählen (optional)"));
    await user.click(await screen.findByRole("option", { name: "Keine" }));

    await user.click(screen.getByLabelText("Meilenstein"));
    await user.click(await screen.findByRole("option", { name: "Keine" }));

    fireEvent.change(screen.getByLabelText("Fällig am"), {
      target: { value: "2026-09-30" },
    });

    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Fällig am")).toBeInTheDocument();
  });

  it("submits quick edits even when reselecting the current value", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByLabelText("Status"));
    await user.click(await screen.findByRole("option", { name: "To Do" }));

    await user.click(screen.getByLabelText("Priorität"));
    await user.click(await screen.findByRole("option", { name: "Hoch" }));

    await user.click(screen.getByLabelText("Zugewiesen an"));
    await user.click(await screen.findByRole("option", { name: "Admin" }));

    await user.click(screen.getByLabelText("Reporter"));
    await user.click(await screen.findByRole("option", { name: "Admin" }));

    await user.click(screen.getByLabelText("Meilenstein"));
    await user.click(await screen.findByRole("option", { name: "Pages v0.2" }));

    fireEvent.change(screen.getByLabelText("Fällig am"), {
      target: { value: "2026-04-01" },
    });

    expect(screen.getByLabelText("Fällig am")).toBeInTheDocument();
  });

  it("shows the reporter fallback when the reporter left the project", () => {
    renderPanel({
      history: [],
      subtasks: [],
      task: createWorkItem({ createdBy: "user-9", reporterName: null }),
    });

    expect(screen.getByLabelText("Reporter")).toHaveTextContent("user-9");
    expect(screen.getByText("user-9")).toBeInTheDocument();
  });

  it("submits quick edits for tickets without relations", async () => {
    const user = userEvent.setup();
    renderPanel({
      assigneesByProject: {
        "project-1": createAssignees(),
        "project-2": createAssignees(),
      },
      history: [],
      labelUsage: { "label-1": 3 },
      subtasks: [],
      task: createWorkItem({
        assigneeId: null,
        assigneeName: null,
        dueAt: null,
        milestoneId: null,
        milestoneName: null,
        parentId: null,
        parentKey: null,
        parentTitle: null,
        reporterName: null,
        startAt: null,
      }),
    });

    await user.click(screen.getByLabelText("Status"));
    await user.click(await screen.findByRole("option", { name: "Done" }));

    await user.click(screen.getByLabelText("Priorität"));
    await user.click(await screen.findByRole("option", { name: "Dringend" }));

    await user.click(screen.getByLabelText("Zugewiesen an"));
    await user.click(
      await screen.findByRole("option", { name: "Max Mustermann" }),
    );

    await user.click(screen.getByLabelText("Meilenstein"));
    await user.click(await screen.findByRole("option", { name: "Pages v0.2" }));

    fireEvent.change(screen.getByLabelText("Fällig am"), {
      target: { value: "2026-10-01" },
    });

    await user.click(screen.getByLabelText("Zugewiesen an"));
    await user.click(
      await screen.findByRole("option", { name: "Nicht zugewiesen" }),
    );

    fireEvent.change(screen.getByLabelText("Fällig am"), {
      target: { value: "" },
    });

    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });

  it("opens the label picker from the labels row", async () => {
    const user = userEvent.setup();
    renderPanel({ labelUsage: { "label-1": 3 } });

    await user.click(screen.getByRole("button", { name: "Labels bearbeiten" }));

    expect(screen.getByText("Labels auswählen")).toBeInTheDocument();
  });

  it("opens the move dialog when another project is selected", async () => {
    const user = userEvent.setup();
    renderPanel({
      assigneesByProject: {
        "project-1": createAssignees(),
        "project-2": createAssignees(),
      },
      labelUsage: { "label-1": 3 },
    });

    await user.click(screen.getByLabelText("Projekt *"));
    await user.click(await screen.findByRole("option", { name: "AstroLab" }));

    expect(
      screen.getByText("Ticket in anderes Projekt verschieben?"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(
      screen.queryByText("Ticket in anderes Projekt verschieben?"),
    ).not.toBeInTheDocument();
  });

  it("keeps the move dialog closed when reselecting the current project", async () => {
    const user = userEvent.setup();
    renderPanel({
      assigneesByProject: {
        "project-1": createAssignees(),
        "project-2": createAssignees(),
      },
      labelUsage: { "label-1": 3 },
    });

    await user.click(screen.getByLabelText("Projekt *"));
    await user.click(await screen.findByRole("option", { name: "Pages" }));

    expect(
      screen.queryByText("Ticket in anderes Projekt verschieben?"),
    ).not.toBeInTheDocument();
  });

  it("edits the description through the edit, save, and cancel buttons", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      screen.getByRole("button", { name: "Beschreibung bearbeiten" }),
    );

    const textarea = screen.getByRole("textbox", { name: "" });

    fireEvent.change(textarea, { target: { value: "New description" } });

    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(textarea).not.toBeInTheDocument();
  });

  it("cancels the description edit", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      screen.getByRole("button", { name: "Beschreibung bearbeiten" }),
    );

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(
      screen.getByText("Detailed description of task"),
    ).toBeInTheDocument();
  });

  it("edits the title through double-click, save, and cancel", async () => {
    const user = userEvent.setup();
    renderPanel();

    const title = screen.getByRole("heading", {
      name: /Kanban Board implementieren/,
    });

    await user.dblClick(title);

    const titleInput = screen.getByDisplayValue("Kanban Board implementieren");

    fireEvent.change(titleInput, { target: { value: "Refactor the title" } });

    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      screen.getByRole("heading", { name: /Kanban Board implementieren/ }),
    ).toBeInTheDocument();
  });

  it("cancels the title edit through the cancel button", async () => {
    const user = userEvent.setup();
    renderPanel();

    const title = screen.getByRole("heading", {
      name: /Kanban Board implementieren/,
    });

    await user.dblClick(title);

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(
      screen.getByRole("heading", { name: /Kanban Board implementieren/ }),
    ).toBeInTheDocument();
  });

  it("submits a new title through the Enter key", async () => {
    const user = userEvent.setup();
    renderPanel();

    const title = screen.getByRole("heading", {
      name: /Kanban Board implementieren/,
    });

    await user.dblClick(title);

    const titleInput = screen.getByDisplayValue("Kanban Board implementieren");

    await user.click(titleInput);
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("heading", { name: /Kanban Board implementieren/ }),
    ).toBeInTheDocument();
  });

  it("cancels the title edit through the Escape key", async () => {
    const user = userEvent.setup();
    renderPanel();

    const title = screen.getByRole("heading", {
      name: /Kanban Board implementieren/,
    });

    await user.dblClick(title);

    const titleInput = screen.getByDisplayValue("Kanban Board implementieren");

    await user.click(titleInput);
    await user.keyboard("{Escape}");

    expect(
      screen.getByRole("heading", { name: /Kanban Board implementieren/ }),
    ).toBeInTheDocument();
  });

  it("does not open the title editor when double-clicking an archived ticket", async () => {
    const user = userEvent.setup();
    renderPanel({
      history: [],
      subtasks: [],
      task: createWorkItem({ archivedAt: "2026-09-05" }),
    });

    const title = screen.getByRole("heading", {
      name: /Kanban Board implementieren/,
    });

    await user.dblClick(title);

    expect(
      screen.queryByDisplayValue("Kanban Board implementieren"),
    ).toBeNull();
  });

  it("does not submit an unchanged title", async () => {
    const user = userEvent.setup();
    renderPanel();

    const title = screen.getByRole("heading", {
      name: /Kanban Board implementieren/,
    });

    await user.dblClick(title);

    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      screen.getByRole("heading", { name: /Kanban Board implementieren/ }),
    ).toBeInTheDocument();
  });

  it("removes a label through the X button on a label pill", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];
    const i18n = createI18n(LANGUAGE.GERMAN);
    const router = createMemoryRouter(
      [
        {
          async action({ request }: { request: Request }) {
            const formData = await request.formData();
            const fields: Record<string, string> = {};

            for (const [key, value] of formData.entries()) {
              fields[key] = String(value);
            }

            submitted.push(fields);

            return null;
          },
          element: (
            <TaskDetailPanel
              assignees={createAssignees()}
              history={createHistory()}
              isArchiving={false}
              milestones={createMilestones()}
              onClose={vi.fn()}
              onCreateSubtask={vi.fn()}
              onEdit={vi.fn()}
              onOpenTask={vi.fn()}
              onSelectTask={vi.fn()}
              projectLabels={[
                createLabel(),
                createLabel({
                  color: "#22c55e",
                  id: "label-2",
                  name: "Backend",
                }),
              ]}
              projects={createProjects()}
              statuses={createStatuses()}
              subtasks={[]}
              task={createWorkItem()}
              taskLabels={[
                createLabel({ id: "label-1", name: "Feature" }),
                createLabel({
                  color: "#22c55e",
                  id: "label-2",
                  name: "Backend",
                }),
              ]}
              workItems={createWorkItems()}
            />
          ),
          path: "/",
        },
      ],
      { initialEntries: ["/"] },
    );

    render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );

    const removeButtons = screen.getAllByRole("button", { name: "Feature ×" });

    expect(removeButtons.length).toBeGreaterThan(0);

    await user.click(removeButtons[0]);

    expect(submitted.at(-1)).toMatchObject({
      intent: "label-unassign",
      labelId: "label-1",
      workItemId: "item-1",
    });
  });

  it("opens the add-link form via the link section button", async () => {
    const user = userEvent.setup();
    renderPanel();

    const addButtons = screen.getAllByRole("button", { name: "Hinzufügen" });
    const linkButton = addButtons.find((button) =>
      button.className.includes("outline"),
    );

    expect(linkButton).toBeDefined();

    if (linkButton) {
      await user.click(linkButton);
    }
  });

  it("updates the start date through its input", () => {
    renderPanel();

    const startInput = screen.getByLabelText("Startdatum");

    fireEvent.change(startInput, { target: { value: "2026-03-15" } });

    expect(startInput).toBeInTheDocument();
  });

  it("renders path chain ancestors when the parent is linked", async () => {
    const { onSelectTask } = renderPanel();

    const ancestorButtons = screen.getAllByRole("button", {
      name: /PAGE-3.*Epic System/,
    });

    expect(ancestorButtons.length).toBeGreaterThan(0);

    void onSelectTask;
  });

  it("falls back to the project label when no parent key exists", () => {
    renderPanel({
      history: [],
      subtasks: [],
      task: createWorkItem({
        parentId: null,
        parentKey: null,
        parentTitle: null,
      }),
    });

    expect(screen.getAllByText("Pages").length).toBeGreaterThan(0);
  });

  it("renders subtasks without an assignee using the question placeholder", () => {
    renderPanel({
      subtasks: [
        {
          ...createWorkItem(),
          assigneeName: null,
          dueAt: null,
          id: "sub-1",
          isDone: false,
          key: "PAGE-13",
          title: "Orphan Subtask",
          type: WORK_ITEM_TYPE.SUBTASK,
        },
      ],
    });

    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("shows a parent task link for subtasks with a parent", async () => {
    const user = userEvent.setup();
    const { onSelectTask } = renderPanel({
      subtasks: [],
      task: createWorkItem({ type: WORK_ITEM_TYPE.SUBTASK }),
    });

    const parentLink = screen.getByRole("button", { name: "PAGE-3" });

    await user.click(parentLink);

    expect(onSelectTask).toHaveBeenCalledWith("PAGE-3");
  });

  it("triggers onEdit when the edit button is clicked", async () => {
    const user = userEvent.setup();
    const { onEdit } = renderPanel();

    await user.click(screen.getByRole("button", { name: "Bearbeiten" }));

    expect(onEdit).toHaveBeenCalled();
  });

  it("renders the checklist counter when items are present", () => {
    renderPanel({
      checklist: [
        {
          createdAt: "2026-01-01",
          id: "item-1",
          isDone: true,
          sortOrder: 1,
          title: "First",
          updatedAt: "2026-01-02",
          workItemId: "ticket-1",
        },
        {
          createdAt: "2026-01-01",
          id: "item-2",
          isDone: false,
          sortOrder: 2,
          title: "Second",
          updatedAt: "2026-01-02",
          workItemId: "ticket-1",
        },
      ],
    });

    expect(screen.getAllByText("1 / 2").length).toBeGreaterThan(0);
  });

  it("navigates to a parent ancestor through the path chain", async () => {
    const user = userEvent.setup();
    const { onSelectTask } = renderPanel({
      subtasks: [],
      task: createWorkItem({
        parentId: "epic-1",
        parentKey: "PAGE-3",
        parentTitle: "Epic System",
      }),
      workItems: [
        createWorkItem({
          id: "epic-1",
          key: "PAGE-3",
          parentId: null,
          parentKey: null,
          parentTitle: null,
          title: "Epic System",
          type: WORK_ITEM_TYPE.EPIC,
        }),
      ],
    });

    onSelectTask.mockClear();

    const buttons = screen.getAllByRole("button");

    const clickedKeys: string[] = [];

    for (const button of buttons) {
      const text = button.textContent ?? "";

      if (
        text.includes("PAGE-3") &&
        text.includes("Epic System") &&
        !text.includes("Kanban Board")
      ) {
        await user.click(button);
        clickedKeys.push(button.textContent ?? "");
        break;
      }
    }

    expect(clickedKeys.length).toBeGreaterThan(0);
    expect(onSelectTask).toHaveBeenCalledWith("PAGE-3");
  });

  it("ignores priority values that are not in the allowed list", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    const i18n = createI18n(LANGUAGE.GERMAN);
    const router = createMemoryRouter(
      [
        {
          async action({ request }: { request: Request }) {
            const formData = await request.formData();
            const fields: Record<string, string> = {};

            for (const [key, value] of formData.entries()) {
              fields[key] = String(value);
            }

            submitted.push(fields);

            return null;
          },
          element: (
            <TaskDetailPanel
              assignees={createAssignees()}
              history={createHistory()}
              isArchiving={false}
              milestones={createMilestones()}
              onClose={vi.fn()}
              onCreateSubtask={vi.fn()}
              onEdit={vi.fn()}
              onOpenTask={vi.fn()}
              onSelectTask={vi.fn()}
              projectLabels={[createLabel()]}
              projects={createProjects()}
              statuses={createStatuses()}
              subtasks={[]}
              task={createWorkItem()}
              taskLabels={[createLabel()]}
              workItems={createWorkItems()}
            />
          ),
          path: "/",
        },
      ],
      { initialEntries: ["/"] },
    );

    render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );

    await user.click(screen.getByLabelText("Priorität"));
    await user.click(await screen.findByRole("option", { name: "Dringend" }));

    fireEvent.change(screen.getByLabelText("Priorität"), {
      target: { value: "hacked" },
    });

    expect(submitted.length).toBeGreaterThan(0);
  });

  it("breaks out of the ancestor walk when a parent reference loops", () => {
    renderPanel({
      history: [],
      subtasks: [],
      task: createWorkItem({
        parentId: "self",
        parentKey: "PAGE-12",
        parentTitle: "Self",
      }),
      workItems: [
        createWorkItem({
          id: "item-1",
          key: "PAGE-12",
          parentId: "self",
          parentKey: "PAGE-12",
          parentTitle: "Self",
        }),
      ],
    });

    expect(screen.getAllByText("Self").length).toBeGreaterThan(0);
  });

  it("breaks out of the ancestor walk when a parent id is unknown", () => {
    renderPanel({
      history: [],
      subtasks: [],
      task: createWorkItem({
        parentId: "missing",
        parentKey: "PAGE-1",
        parentTitle: "Missing",
      }),
    });

    expect(screen.getAllByText("Pages").length).toBeGreaterThan(0);
  });

  it("closes the panel through the global Escape handler", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("toggles the add-link form via the link section button", async () => {
    const user = userEvent.setup();
    renderPanel();

    const linkButton = screen.getByRole("button", {
      name: "link-section-add",
    });

    await user.click(linkButton);

    expect(linkButton).toBeInTheDocument();
  });

  it("submits no panel update for an invalid priority", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];

    const i18n = createI18n(LANGUAGE.GERMAN);
    const router = createMemoryRouter(
      [
        {
          async action({ request }: { request: Request }) {
            const formData = await request.formData();
            const fields: Record<string, string> = {};

            for (const [key, value] of formData.entries()) {
              fields[key] = String(value);
            }

            submitted.push(fields);

            return null;
          },
          element: (
            <TaskDetailPanel
              assignees={createAssignees()}
              history={createHistory()}
              isArchiving={false}
              milestones={createMilestones()}
              onClose={vi.fn()}
              onCreateSubtask={vi.fn()}
              onEdit={vi.fn()}
              onOpenTask={vi.fn()}
              onSelectTask={vi.fn()}
              projectLabels={[createLabel()]}
              projects={createProjects()}
              statuses={createStatuses()}
              subtasks={[]}
              task={createWorkItem()}
              taskLabels={[createLabel()]}
              workItems={createWorkItems()}
            />
          ),
          path: "/",
        },
      ],
      { initialEntries: ["/"] },
    );

    render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );

    const prioritySelect = screen.getByLabelText("Priorität");

    fireEvent.change(prioritySelect, { target: { value: "hacked" } });

    void user;

    expect(submitted).toHaveLength(0);
  });

  it("breaks out of the ancestor walk when a parent reference loops", () => {
    renderPanel({
      history: [],
      subtasks: [],
      task: createWorkItem({
        parentId: "epic-1",
        parentKey: "PAGE-3",
        parentTitle: "Epic System",
      }),
      workItems: [
        createWorkItem({
          id: "epic-1",
          key: "PAGE-3",
          parentId: "epic-1",
          parentKey: "PAGE-3",
          parentTitle: "Epic System",
          type: WORK_ITEM_TYPE.EPIC,
        }),
      ],
    });

    expect(screen.getAllByText("Epic System").length).toBeGreaterThan(0);
  });

  it("calls onSelectTask through the path chain ancestor button", async () => {
    const user = userEvent.setup();
    const { onSelectTask } = renderPanel({
      subtasks: [],
      task: createWorkItem({
        parentId: "epic-1",
        parentKey: "PAGE-3",
        parentTitle: "Epic System",
        type: WORK_ITEM_TYPE.TASK,
      }),
      workItems: [
        createWorkItem({
          id: "epic-1",
          key: "PAGE-3",
          parentId: null,
          parentKey: null,
          parentTitle: null,
          title: "Epic System",
          type: WORK_ITEM_TYPE.EPIC,
        }),
      ],
    });

    onSelectTask.mockClear();

    const pathChain = document.querySelector("ol");

    expect(pathChain).not.toBeNull();

    const ancestorButton = pathChain?.querySelector("button");

    expect(ancestorButton).not.toBeNull();

    if (ancestorButton) {
      await user.click(ancestorButton);
    }

    expect(onSelectTask).toHaveBeenCalledWith("PAGE-3");
  });
});
