// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TaskFormDialog } from "@/app/components/tasks/task-form-dialog";
import { TicketAccessProvider } from "@/app/components/tasks/ticket-access";
import { createI18n } from "@/app/lib/i18n";
import {
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
  WORKFLOW_STATUS_KEY,
} from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import { createUser } from "../helpers/factories";

import type { Project } from "@/definition/Project";
import type {
  Milestone,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";
import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";

function createProject(): Project {
  return {
    createdAt: "2026-01-01",
    description: "Pages Project",
    departments: [],
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

function createWorkItem(): WorkItemDetail {
  return {
    departmentId: null,
    archivedAt: null,
    assigneeId: "user-1",
    assigneeGroupId: null,
    assigneeName: "Admin",
    assigneeGroupName: null,
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

function createTemplate(
  overrides: Partial<WorkItemTemplateView> = {},
): WorkItemTemplateView {
  return {
    canManage: true,
    checklist: ["Reproduzieren", "Beheben"],
    createdAt: "2026-01-01",
    departmentIds: [],
    description: "Schritte zum Nachstellen",
    id: "template-1",
    labelIds: ["label-1"],
    name: "Fehlerbericht",
    ownerId: "user-1",
    priority: WORK_ITEM_PRIORITY.URGENT,
    projectIds: [],
    scope: "private",
    title: "Fehler: ",
    type: WORK_ITEM_TYPE.EPIC,
    updatedAt: "2026-01-01",
    ...overrides,
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
      <TicketAccessProvider
        value={{
          projects: [],
          assigneeGroups: [],
          canDelete: false,
          canWrite: true,
          departments: [{ id: "department-1", name: "Entwicklung" }],
        }}
      >
        <RouterProvider router={router} />
      </TicketAccessProvider>
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

  it("hints that the description supports markdown", () => {
    renderDialog({ mode: "create" });

    expect(screen.getByLabelText("Beschreibung")).toHaveAccessibleDescription(
      "Markdown wird unterstützt.",
    );
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
        assigneeGroupId: null,
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

  it("offers an optional department only when creating", async () => {
    const user = userEvent.setup();
    renderDialog({ mode: "create" });

    expect(screen.getByLabelText("Abteilung")).toHaveTextContent(
      "Keine Abteilung",
    );
    await user.click(screen.getByLabelText("Abteilung"));
    await user.click(
      await screen.findByRole("option", { name: "Entwicklung" }),
    );

    expect(document.querySelector('input[name="departmentId"]')).toHaveValue(
      "department-1",
    );
  });

  it("does not offer the department while editing", () => {
    renderDialog({ initialTask: createWorkItem(), mode: "edit" });

    expect(screen.queryByLabelText("Abteilung")).not.toBeInTheDocument();
    expect(
      document.querySelector('input[name="departmentId"]'),
    ).not.toBeInTheDocument();
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

  it("selects an epic as the parent of a task", async () => {
    const user = userEvent.setup();
    renderDialog({ mode: "create" });

    const parentSelect = screen.getByLabelText("Epic auswählen (optional)");
    await user.click(parentSelect);
    await user.click(
      await screen.findByRole("option", { name: "PAGE-2: Epic 1" }),
    );

    expect(parentSelect).toHaveTextContent("PAGE-2: Epic 1");
  });

  it("changes the reporter of an edited task", async () => {
    const user = userEvent.setup();
    renderDialog({
      assignees: [
        createUser(),
        { ...createUser(), displayName: "Erika", id: "user-2" },
      ],
      initialTask: createWorkItem(),
      mode: "edit",
    });

    const reporterSelect = screen.getByLabelText("Reporter");
    await user.click(reporterSelect);
    await user.click(await screen.findByRole("option", { name: "Erika" }));

    expect(reporterSelect).toHaveTextContent("Erika");
  });

  it("offers no parent for an initiative", async () => {
    const user = userEvent.setup();
    renderDialog({ mode: "create" });

    await user.click(screen.getByLabelText("Typ *"));
    await user.click(await screen.findByRole("option", { name: "Initiative" }));

    expect(
      screen.queryByLabelText("Epic auswählen (optional)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Initiative auswählen (optional)"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing while the dialog is closed", () => {
    renderDialog({ isOpen: false, mode: "create" });

    expect(screen.queryByLabelText("Typ *")).not.toBeInTheDocument();
  });

  it("starts in the default project when it is available", () => {
    renderDialog({ defaultProjectId: "project-2", mode: "create" });

    expect(screen.getByLabelText("Projekt *")).toHaveTextContent("AstroLab");
  });

  it("starts in the first project when the default project is unknown", () => {
    renderDialog({ defaultProjectId: "project-9", mode: "create" });

    expect(screen.getByLabelText("Projekt *")).toHaveTextContent("Pages");
  });

  it("switches project to update available milestones and parents", async () => {
    const user = userEvent.setup();
    renderDialog({ mode: "create" });

    const projectSelect = screen.getByLabelText("Projekt *");
    await user.click(projectSelect);
    await user.click(await screen.findByRole("option", { name: "AstroLab" }));

    expect(projectSelect).toHaveTextContent("AstroLab");
  });

  it("offers no template field without templates or while editing", () => {
    renderDialog({ mode: "create" });
    expect(screen.queryByLabelText("Aus Vorlage")).not.toBeInTheDocument();
  });

  it("does not offer templates while editing", () => {
    renderDialog({
      initialTask: createWorkItem(),
      mode: "edit",
      templates: [createTemplate()],
    });

    expect(screen.queryByLabelText("Aus Vorlage")).not.toBeInTheDocument();
    expect(
      document.querySelector('input[name="templateId"]'),
    ).not.toBeInTheDocument();
  });

  it("presets a new ticket from the chosen template", async () => {
    const user = userEvent.setup();
    renderDialog({ mode: "create", templates: [createTemplate()] });

    await user.click(screen.getByLabelText("Aus Vorlage"));
    await user.click(
      await screen.findByRole("option", { name: "Fehlerbericht" }),
    );

    expect(screen.getByLabelText("Titel *")).toHaveValue("Fehler: ");
    expect(screen.getByLabelText("Beschreibung")).toHaveValue(
      "Schritte zum Nachstellen",
    );
    expect(screen.getByLabelText("Priorität")).toHaveTextContent("Dringend");
    expect(document.querySelector('input[name="type"]')).toHaveValue("epic");
    expect(document.querySelector('input[name="templateId"]')).toHaveValue(
      "template-1",
    );
    expect(
      screen.getByText(/Labels \(1\) und Checklistenpunkte \(2\)/),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText("Aus Vorlage"));
    await user.click(
      await screen.findByRole("option", { name: "Keine Vorlage" }),
    );

    expect(screen.getByLabelText("Titel *")).toHaveValue("");
    expect(document.querySelector('input[name="templateId"]')).toHaveValue("");
    expect(screen.queryByText(/Checklistenpunkte/)).not.toBeInTheDocument();
  });

  it("keeps the type of a ticket created below a parent", async () => {
    const user = userEvent.setup();
    renderDialog({
      defaultParentId: "epic-1",
      defaultType: WORK_ITEM_TYPE.TASK,
      mode: "create",
      templates: [createTemplate()],
    });

    await user.click(screen.getByLabelText("Aus Vorlage"));
    await user.click(
      await screen.findByRole("option", { name: "Fehlerbericht" }),
    );

    expect(document.querySelector('input[name="type"]')).toHaveValue("task");
    expect(screen.getByLabelText("Titel *")).toHaveValue("Fehler: ");
  });
});
