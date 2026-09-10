// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TaskMoveDialog } from "@/app/components/tasks/task-move-dialog";
import { createI18n } from "@/app/lib/i18n";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { Project } from "@/definition/Project";
import type {
  Milestone,
  ProjectLabel,
  WorkItemDetail,
} from "@/definition/Task";
import type { User } from "@/definition/User";

function createProject(overrides: Partial<Project> = {}): Project {
  return {
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
    ...overrides,
  };
}

function createTask(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeId: "user-1",
    assigneeName: "Admin",
    reporterName: "Alex Berger",
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    description: "",
    dueAt: "2026-09-30",
    githubConflict: false,
    githubContentHash: null,
    githubIssueNumber: 42,
    githubIssueState: "open",
    githubIssueUpdatedAt: "2026-09-05T14:00:00.000Z",
    githubIssueUrl: "https://github.com/user/pages/issues/42",
    githubLastError: null,
    githubLastSyncAt: "2026-09-05T14:00:00.000Z",
    id: "item-14",
    isDone: false,
    key: "PAGE-14",
    milestoneId: "milestone-1",
    milestoneName: "MVP",
    number: 14,
    parentId: "epic-1",
    parentKey: "PAGE-3",
    parentTitle: "Projektverwaltung",
    priority: WORK_ITEM_PRIORITY.HIGH,
    progressPercentage: 0,
    projectId: "project-1",
    projectName: "Pages",
    sortOrder: 14,
    startAt: null,
    statusId: "status-todo",
    statusKey: "todo",
    statusName: "To Do",
    subtaskCompleted: 0,
    subtaskTotal: 0,
    title: "Login Seite erstellen",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-09-05T14:00:00.000Z",
    ...overrides,
  };
}

function createMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    archivedAt: null,
    completedAt: null,
    createdAt: "2026-01-01",
    description: "",
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

function createUser(overrides: Partial<User> = {}): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: "admin",
    username: "admin",
    ...overrides,
  };
}

const PROJECTS = [
  createProject(),
  createProject({ description: "Astro", id: "project-2", name: "AstroLab" }),
];

function renderDialog(
  properties: Partial<Parameters<typeof TaskMoveDialog>[0]>,
  onAction: (fields: Record<string, string>) => void = () => {},
): void {
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

          onAction(fields);

          return null;
        },
        element: (
          <TaskMoveDialog
            assigneesByProject={{
              "project-1": [createUser()],
              "project-2": [
                createUser({
                  displayName: "Max Mustermann",
                  id: "user-2",
                  username: "max",
                }),
              ],
            }}
            isOpen={true}
            milestones={[createMilestone()]}
            onOpenChange={vi.fn()}
            projects={PROJECTS}
            task={createTask()}
            taskLabels={[createLabel()]}
            workItems={[
              createTask({
                id: "epic-1",
                key: "PAGE-3",
                parentId: null,
                parentKey: null,
                parentTitle: null,
                title: "Projektverwaltung",
                type: WORK_ITEM_TYPE.EPIC,
              }),
            ]}
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

describe("TaskMoveDialog", () => {
  it("lists dropped relations and moves on confirm", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];
    const admin = createUser();
    renderDialog(
      {
        assigneesByProject: {
          "project-1": [admin],
          "project-2": [
            admin,
            createUser({
              displayName: "Max Mustermann",
              id: "user-2",
              username: "max",
            }),
          ],
        },
      },
      (fields) => submitted.push(fields),
    );

    await user.click(screen.getByLabelText("Zielprojekt"));
    await user.click(await screen.findByRole("option", { name: "AstroLab" }));

    expect(screen.getByText("Pages → AstroLab")).toBeInTheDocument();
    expect(screen.getByText("PAGE-3 Projektverwaltung")).toBeInTheDocument();
    expect(screen.getByText("MVP")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Verschieben" }));

    expect(submitted.at(-1)).toMatchObject({
      id: "item-14",
      intent: "move-project",
      targetProjectId: "project-2",
    });
  });

  it("keeps every relation when nothing is dropped", async () => {
    const user = userEvent.setup();
    renderDialog({
      assigneesByProject: {},
      milestones: [
        createMilestone({
          id: "m-2",
          name: "Astro MS",
          projectId: "project-2",
        }),
      ],
      projects: [
        createProject({
          description: "Astro",
          id: "project-2",
          name: "AstroLab",
        }),
      ],
      task: createTask({
        assigneeId: null,
        assigneeName: null,
        githubIssueNumber: null,
        githubIssueUrl: null,
        milestoneId: "m-2",
        milestoneName: "Astro MS",
        parentId: null,
        parentKey: null,
        parentTitle: null,
      }),
      taskLabels: [],
      workItems: [
        createTask({
          id: "other-1",
          key: "ASTRO-1",
          projectId: "project-2",
          projectName: "AstroLab",
          title: "Other",
        }),
      ],
    });

    await user.click(screen.getByLabelText("Zielprojekt"));
    await user.click(await screen.findByRole("option", { name: "AstroLab" }));

    expect(screen.getByText("Pages → AstroLab")).toBeInTheDocument();
    expect(
      screen.getByText("Alle Verknüpfungen bleiben erhalten."),
    ).toBeInTheDocument();
  });

  it("drops relations without readable names safely", async () => {
    const user = userEvent.setup();
    renderDialog({
      milestones: [
        createMilestone({ id: "m-9", name: "Other", projectId: "project-2" }),
      ],
      task: createTask({
        assigneeName: null,
        parentTitle: null,
      }),
      workItems: [],
    });

    await user.click(screen.getByLabelText("Zielprojekt"));
    await user.click(await screen.findByRole("option", { name: "AstroLab" }));

    expect(
      screen.getByText(
        "Folgende Verknüpfungen werden entfernt oder müssen neu zugeordnet werden:",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("PAGE-3")).toBeInTheDocument();
  });

  it("keeps parents that already live in the target project", async () => {
    const user = userEvent.setup();
    renderDialog({
      task: createTask({
        milestoneId: null,
        milestoneName: null,
        parentId: "epic-9",
        parentKey: "PAGE-9",
        parentTitle: "Verwaltung",
      }),
      taskLabels: [],
      workItems: [
        createTask({
          id: "epic-9",
          key: "PAGE-9",
          parentId: null,
          parentKey: null,
          parentTitle: null,
          projectId: "project-2",
          projectName: "AstroLab",
          title: "Verwaltung",
          type: WORK_ITEM_TYPE.EPIC,
        }),
      ],
    });

    await user.click(screen.getByLabelText("Zielprojekt"));
    await user.click(await screen.findByRole("option", { name: "AstroLab" }));

    expect(screen.queryByText("PAGE-9")).not.toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("disables the move action while submitting", () => {
    renderDialog({ isSubmitting: true });

    expect(screen.getByRole("button", { name: "Verschieben" })).toBeDisabled();
  });
});
