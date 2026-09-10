// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TaskFormDialog } from "@/app/components/tasks/task-form-dialog";
import { createI18n } from "@/app/lib/i18n";
import { ROLE } from "@/definition/Role";
import {
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
  WORKFLOW_STATUS_KEY,
} from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { Project } from "@/definition/Project";
import type {
  Milestone,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

function createProject(): Project {
  return {
    createdAt: "2026-01-01",
    description: "Pages Project",
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
  };
}

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

function createMilestone(): Milestone {
  return {
    archivedAt: null,
    completedAt: null,
    createdAt: "2026-01-01",
    description: "Release v1",
    dueAt: "2026-05-01",
    id: "milestone-1",
    name: "v1.0",
    projectId: "project-1",
    startAt: "2026-01-01",
    status: "open",
    updatedAt: "2026-01-02",
  };
}

function createUser(): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
  };
}

function createWorkItem(): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeId: "user-1",
    assigneeName: "Admin",
    reporterName: "Reporter",
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    description: "Test task description",
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
    key: "PAGE-1",
    milestoneId: "milestone-1",
    milestoneName: "v1.0",
    number: 1,
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
    title: "Kanban Task",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-02",
  };
}

function renderDialog(
  properties: Partial<Parameters<typeof TaskFormDialog>[0]> = {},
): void {
  const i18n = createI18n(LANGUAGE.GERMAN);
  const router = createMemoryRouter(
    [
      {
        element: (
          <TaskFormDialog
            assignees={[createUser()]}
            existingWorkItems={[
              createWorkItem(),
              {
                ...createWorkItem(),
                id: "epic-1",
                key: "PAGE-2",
                title: "Epic 1",
                type: WORK_ITEM_TYPE.EPIC,
              },
            ]}
            isOpen={true}
            isSubmitting={false}
            milestones={[createMilestone()]}
            mode="create"
            onOpenChange={vi.fn()}
            projects={[
              createProject(),
              {
                ...createProject(),
                id: "project-2",
                name: "AstroLab",
              },
            ]}
            statuses={createStatuses()}
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
}

describe("TaskFormDialog", () => {
  it("renders in create mode with default fields", () => {
    renderDialog({ mode: "create" });

    expect(
      screen.getByRole("heading", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Aufgabe erstellen" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Titel *")).toBeInTheDocument();
    expect(screen.getByLabelText("Projekt *")).toBeInTheDocument();
  });

  it("renders in edit mode with prepopulated task details", () => {
    const task = createWorkItem();
    renderDialog({ initialTask: task, mode: "edit" });

    expect(
      screen.getByRole("heading", { name: "Aufgabe bearbeiten" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Speichern" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kanban Task")).toBeInTheDocument();
    expect(screen.getByLabelText("Reporter")).toHaveTextContent("Admin");
    expect(screen.getByLabelText("Startdatum")).toBeInTheDocument();
  });

  it("shows a reporter fallback when the reporter left the project", () => {
    renderDialog({
      assignees: [],
      initialTask: createWorkItem(),
      mode: "edit",
    });

    expect(screen.getAllByText("Reporter").length).toBeGreaterThan(0);
  });

  it("falls back to the reporter id without a stored name", () => {
    renderDialog({
      assignees: [],
      initialTask: { ...createWorkItem(), reporterName: null },
      mode: "edit",
    });

    expect(screen.getByLabelText("Reporter")).toHaveTextContent("user-1");
  });

  it("hides reporter selection when creating without a task", () => {
    renderDialog({ mode: "edit" });

    expect(screen.queryByLabelText("Reporter")).not.toBeInTheDocument();
  });

  it("falls back to unassigned, no milestone, and no parent when editing sparse tasks", () => {
    renderDialog({
      initialTask: {
        ...createWorkItem(),
        assigneeId: null,
        milestoneId: null,
        parentId: null,
      },
      mode: "edit",
    });

    expect(screen.getByLabelText("Zugewiesen an")).toHaveTextContent(
      "Nicht zugewiesen",
    );
    expect(
      screen.getByLabelText("Epic auswählen (optional)"),
    ).toHaveTextContent("Keine");
    expect(screen.getByLabelText("Meilenstein")).toHaveTextContent("Keine");
  });

  it("displays an error message when provided", () => {
    renderDialog({ error: "invalidInput" });

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("switches type between task, epic, and subtask", async () => {
    const user = userEvent.setup();
    renderDialog({ mode: "create" });

    const typeSelect = screen.getByLabelText("Typ *");

    await user.click(typeSelect);
    await user.click(await screen.findByRole("option", { name: "Epic" }));
    expect(
      screen.queryByLabelText("Übergeordneter Task *"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Epic auswählen (optional)"),
    ).not.toBeInTheDocument();

    await user.click(typeSelect);
    await user.click(await screen.findByRole("option", { name: "Subtask" }));
    expect(screen.getByLabelText("Übergeordneter Task *")).toBeInTheDocument();

    await user.click(typeSelect);
    await user.click(await screen.findByRole("option", { name: "Task" }));
    expect(
      screen.getByLabelText("Epic auswählen (optional)"),
    ).toBeInTheDocument();
  });

  it("selects initiatives as epic parents", async () => {
    const user = userEvent.setup();
    renderDialog({
      existingWorkItems: [
        createWorkItem(),
        {
          ...createWorkItem(),
          id: "init-1",
          key: "PAGE-1",
          title: "Platform",
          type: WORK_ITEM_TYPE.INITIATIVE,
        },
      ],
      mode: "create",
    });

    await user.click(screen.getByLabelText("Typ *"));
    await user.click(await screen.findByRole("option", { name: "Epic" }));

    expect(
      screen.getByLabelText("Initiative auswählen (optional)"),
    ).toBeInTheDocument();
    expect(screen.getByText("PAGE-1: Platform")).toBeInTheDocument();
  });

  it("handles empty projects and statuses", () => {
    renderDialog({ mode: "create", projects: [], statuses: [] });

    expect(screen.getByLabelText("Typ *")).toBeInTheDocument();
  });

  it("changes priority, status, assignee, and milestone when creating", async () => {
    const user = userEvent.setup();
    renderDialog({ mode: "create" });

    await user.click(screen.getByLabelText("Priorität"));
    await user.click(await screen.findByRole("option", { name: "Dringend" }));
    expect(screen.getByLabelText("Priorität")).toHaveTextContent("Dringend");

    await user.click(screen.getByLabelText("Status"));
    await user.click(await screen.findByRole("option", { name: "Done" }));
    expect(screen.getByLabelText("Status")).toHaveTextContent("Done");

    await user.click(screen.getByLabelText("Zugewiesen an"));
    await user.click(await screen.findByRole("option", { name: "Admin" }));
    expect(screen.getByLabelText("Zugewiesen an")).toHaveTextContent("Admin");

    await user.click(screen.getByLabelText("Meilenstein"));
    await user.click(await screen.findByRole("option", { name: "v1.0" }));
    expect(screen.getByLabelText("Meilenstein")).toHaveTextContent("v1.0");
  });

  it("shows submitting progress when creating", () => {
    renderDialog({ isSubmitting: true, mode: "create" });

    expect(
      screen.getByRole("button", { name: "Wird erstellt …" }),
    ).toBeDisabled();
  });

  it("shows submitting progress when editing", () => {
    renderDialog({
      initialTask: createWorkItem(),
      isSubmitting: true,
      mode: "edit",
    });

    expect(
      screen.getByRole("button", { name: "Wird gespeichert …" }),
    ).toBeDisabled();
  });

  it("edits initiatives with prepopulated values", () => {
    renderDialog({
      existingWorkItems: [
        createWorkItem(),
        {
          ...createWorkItem(),
          id: "init-1",
          key: "PAGE-1",
          title: "Platform",
          type: WORK_ITEM_TYPE.INITIATIVE,
        },
        {
          ...createWorkItem(),
          key: "PAGE-9",
          title: "Self",
          type: WORK_ITEM_TYPE.INITIATIVE,
        },
      ],
      initialTask: { ...createWorkItem(), type: WORK_ITEM_TYPE.EPIC },
      mode: "edit",
    });

    expect(screen.getByLabelText("Typ *")).toHaveTextContent("Epic");
    expect(
      screen.getByLabelText("Initiative auswählen (optional)"),
    ).toBeInTheDocument();
    expect(screen.getByText("PAGE-1: Platform")).toBeInTheDocument();
    expect(screen.queryByText("PAGE-9: Self")).not.toBeInTheDocument();
  });

  it("switches project to update available milestones and parents", async () => {
    const user = userEvent.setup();
    renderDialog({ mode: "create" });

    const projectSelect = screen.getByLabelText("Projekt *");
    await user.click(projectSelect);
    await user.click(await screen.findByRole("option", { name: "AstroLab" }));

    expect(projectSelect).toHaveTextContent("AstroLab");
  });
});
