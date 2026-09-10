// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useLoaderData: vi.fn(),
    useNavigate: vi.fn(),
    useNavigation: vi.fn(),
    useSubmit: vi.fn(() => vi.fn()),
  };
});

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";

import TaskDetailRoute from "@/app/routes/task-detail";
import { createI18n } from "@/app/lib/i18n";
import { ROLE } from "@/definition/Role";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { Project } from "@/definition/Project";
import type {
  Milestone,
  ProjectLabel,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

const mockedActionData = vi.mocked(useActionData);
const mockedLoaderData = vi.mocked(useLoaderData);
const mockedNavigate = vi.mocked(useNavigate);
const mockedNavigation = vi.mocked(useNavigation);
const mockedSubmit = vi.mocked(useSubmit);

function createUser(overrides: Partial<User> = {}): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
    ...overrides,
  };
}

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

function createStatuses(): WorkflowStatus[] {
  return [
    {
      id: "status-todo",
      isDone: false,
      key: "todo",
      name: "To Do",
      position: 1,
      projectId: null,
    },
    {
      id: "status-done",
      isDone: true,
      key: "done",
      name: "Done",
      position: 2,
      projectId: null,
    },
  ];
}

function createTicket(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeId: "user-1",
    assigneeName: "Admin",
    reporterName: "Alex Berger",
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    description: "Login umsetzen",
    dueAt: "2026-09-30",
    githubConflict: false,
    githubContentHash: null,
    githubIssueNumber: null,
    githubIssueState: null,
    githubIssueUpdatedAt: null,
    githubIssueUrl: null,
    githubLastError: null,
    githubLastSyncAt: null,
    id: "item-14",
    isDone: false,
    key: "PAGE-14",
    milestoneId: null,
    milestoneName: null,
    number: 14,
    parentId: "parent-1",
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
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function createMilestone(): Milestone {
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
  };
}

function createLabel(): ProjectLabel {
  return {
    color: "#3b82f6",
    createdAt: "2026-01-01",
    id: "label-1",
    name: "Feature",
    projectId: "project-1",
    updatedAt: "2026-01-02",
  };
}

function createEpicTask(): WorkItemDetail {
  return createTicket({
    id: "epic-1",
    key: "PAGE-3",
    parentId: null,
    parentKey: null,
    parentTitle: null,
    title: "Projektverwaltung",
    type: WORK_ITEM_TYPE.EPIC,
  });
}

function renderDetail(loaderOverrides: Record<string, unknown> = {}): void {
  mockedLoaderData.mockReturnValue({
    actor: createUser(),
    assignees: [
      createUser(),
      createUser({ displayName: "Max Mustermann", id: "user-2" }),
    ],
    assigneesByProject: {
      "project-1": [
        createUser(),
        createUser({ displayName: "Max Mustermann", id: "user-2" }),
      ],
    },
    children: [
      createTicket({
        id: "sub-1",
        key: "PAGE-14.1",
        parentId: "item-14",
        title: "UI erstellen",
        type: WORK_ITEM_TYPE.SUBTASK,
      }),
    ],
    fromView: "kanban",
    history: [],
    labelUsage: { "label-1": 1 },
    milestones: [createMilestone()],
    parent: createTicket({
      id: "parent-1",
      key: "PAGE-3",
      parentId: null,
      parentKey: null,
      parentTitle: null,
      title: "Projektverwaltung",
      type: WORK_ITEM_TYPE.EPIC,
    }),
    project: createProject(),
    projectLabels: [createLabel()],
    projectWorkItems: [
      createEpicTask(),
      createTicket({
        id: "self-epic",
        key: "PAGE-99",
        parentId: null,
        parentKey: null,
        parentTitle: null,
        title: "Eigenes Epic",
        type: WORK_ITEM_TYPE.EPIC,
      }),
      createTicket({
        id: "foreign-epic",
        key: "ANI-9",
        parentId: null,
        parentKey: null,
        parentTitle: null,
        projectId: "project-2",
        projectName: "AstroLab",
        title: "Fremdes Epic",
        type: WORK_ITEM_TYPE.EPIC,
      }),
      createTicket({
        id: "item-14",
        key: "PAGE-14",
        parentId: null,
        parentKey: null,
        parentTitle: null,
        title: "Selbst",
        type: WORK_ITEM_TYPE.EPIC,
      }),
      createTicket({
        id: "task-9",
        key: "PAGE-15",
        parentId: null,
        parentKey: null,
        parentTitle: null,
        title: "Anderer Task",
      }),
    ],
    projects: [
      createProject(),
      createProject({
        description: "Astro",
        id: "project-2",
        name: "AstroLab",
      }),
    ],
    pullRequests: [],
    statuses: createStatuses(),
    taskLabels: [createLabel()],
    ticket: createTicket(),
    ...loaderOverrides,
  });

  const i18n = createI18n(LANGUAGE.GERMAN);
  const router = createMemoryRouter(
    [{ element: <TaskDetailRoute />, path: "/" }],
    { initialEntries: ["/"] },
  );

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("TaskDetailRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedActionData.mockReturnValue(undefined);
    mockedNavigate.mockReturnValue(vi.fn());
    mockedNavigation.mockReturnValue({
      formData: undefined,
      state: "idle",
    } as unknown as ReturnType<typeof useNavigation>);
    mockedSubmit.mockReturnValue(vi.fn());
  });

  it("renders the task full view with breadcrumb and tabs", async () => {
    const user = userEvent.setup();
    renderDetail();

    expect(
      screen.getByRole("heading", { level: 1, name: "Login Seite erstellen" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("PAGE-14")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Aufgaben" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Subtasks/ }));
    expect(screen.getByText("UI erstellen")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Aktivität" }));
    expect(screen.getAllByText("Keine").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: "Beschreibung" }));
    expect(screen.getByText("Login umsetzen")).toBeInTheDocument();
  });

  it("navigates back and opens child tickets", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Zurück" }));
    expect(navigate).toHaveBeenCalledWith("/aufgaben?view=kanban");

    await user.click(screen.getByRole("tab", { name: /Subtasks/ }));
    await user.click(screen.getByText("UI erstellen"));
    expect(navigate).toHaveBeenCalledWith("/aufgaben/PAGE-14.1?from=kanban");
  });

  it("submits header and detail quick edits", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    mockedSubmit.mockReturnValue(submit);
    renderDetail();

    await user.click(screen.getAllByLabelText("Status")[0] as HTMLElement);
    await user.click(await screen.findByRole("option", { name: "Done" }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "move-task" }),
      { method: "post" },
    );

    await user.click(screen.getAllByLabelText("Priorität")[1] as HTMLElement);
    await user.click(await screen.findByRole("option", { name: "Dringend" }));

    await user.click(
      screen.getAllByLabelText("Zugewiesen an")[1] as HTMLElement,
    );
    await user.click(
      await screen.findByRole("option", { name: "Max Mustermann" }),
    );

    await user.click(screen.getByLabelText("Reporter"));
    await user.click(
      await screen.findByRole("option", { name: "Max Mustermann" }),
    );

    await user.click(screen.getByLabelText("Epic auswählen (optional)"));
    await user.click(
      await screen.findByRole("option", { name: "PAGE-3: Projektverwaltung" }),
    );

    await user.click(screen.getByLabelText("Meilenstein"));
    await user.click(await screen.findByRole("option", { name: "MVP" }));

    fireEvent.change(screen.getByLabelText("Fällig am"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("Startdatum"), {
      target: { value: "2026-09-01" },
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "update-task" }),
      { method: "post" },
    );
  });

  it("submits quick edits with empty fallbacks for tickets without relations", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    mockedSubmit.mockReturnValue(submit);
    renderDetail({
      ticket: createTicket({
        assigneeId: null,
        assigneeName: null,
        dueAt: null,
        milestoneId: null,
        milestoneName: null,
        parentId: null,
        parentKey: null,
        parentTitle: null,
        startAt: null,
      }),
    });

    await user.click(screen.getAllByLabelText("Priorität")[1] as HTMLElement);
    await user.click(await screen.findByRole("option", { name: "Dringend" }));

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: "",
        dueAt: "",
        intent: "update-task",
        milestoneId: "",
        parentId: "",
        startAt: "",
      }),
      { method: "post" },
    );
  });

  it("renders epic views with contained tasks and initiative selection", async () => {
    const user = userEvent.setup();
    renderDetail({
      children: [
        createTicket({
          id: "task-1",
          key: "PAGE-12",
          parentId: "epic-1",
          title: "Projekt erstellen",
        }),
      ],
      parent: createTicket({
        id: "init-1",
        key: "PAGE-1",
        parentId: null,
        parentKey: null,
        parentTitle: null,
        title: "Plattform",
        type: WORK_ITEM_TYPE.INITIATIVE,
      }),
      projectWorkItems: [
        createEpicTask(),
        createTicket({
          id: "init-1",
          key: "PAGE-1",
          title: "Plattform",
          type: WORK_ITEM_TYPE.INITIATIVE,
        }),
        createTicket({
          id: "foreign-init",
          key: "ANI-1",
          projectId: "project-2",
          projectName: "AstroLab",
          title: "Fremde Initiative",
          type: WORK_ITEM_TYPE.INITIATIVE,
        }),
        createTicket({
          id: "epic-1",
          key: "EPIC-1",
          title: "Selbst",
          type: WORK_ITEM_TYPE.INITIATIVE,
        }),
      ],
      ticket: createTicket({
        id: "epic-1",
        key: "EPIC-1",
        milestoneId: "milestone-1",
        milestoneName: "MVP",
        parentId: "init-1",
        parentKey: "PAGE-1",
        parentTitle: "Plattform",
        progressPercentage: 50,
        startAt: "2026-09-01",
        subtaskCompleted: 1,
        subtaskTotal: 2,
        title: "Projektverwaltung",
        type: WORK_ITEM_TYPE.EPIC,
      }),
    });

    expect(screen.getByText("Enthaltene Tasks")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Enthaltene Tasks/ }));
    expect(screen.getByText("Projekt erstellen")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Initiative auswählen (optional)"),
    ).toHaveTextContent("PAGE-1: Plattform");
    expect(screen.getByText("1 / 2 (50 %)")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Enthaltene Tasks/ }));
    await user.click(screen.getByRole("button", { name: "Neue Aufgabe" }));
    expect(
      screen.getByRole("heading", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();
  });

  it("renders initiative views with contained epics", async () => {
    const user = userEvent.setup();
    renderDetail({
      children: [createEpicTask()],
      parent: null,
      ticket: createTicket({
        id: "init-1",
        key: "INIT-1",
        parentId: null,
        parentKey: null,
        parentTitle: null,
        title: "Plattform",
        type: WORK_ITEM_TYPE.INITIATIVE,
      }),
    });

    expect(screen.getByText("Enthaltene Epics")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Enthaltene Epics/ }));
    expect(screen.getByText("Projektverwaltung")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Epic auswählen (optional)"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Enthaltene Epics/ }));
    await user.click(screen.getByRole("button", { name: "Epic erstellen" }));
    expect(
      screen.getByRole("heading", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();
  });

  it("renders subtask views with parent links and no children tab", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    renderDetail({
      children: [],
      parent: createTicket(),
      ticket: createTicket({
        assigneeId: null,
        assigneeName: null,
        dueAt: null,
        id: "sub-1",
        key: "PAGE-14.1",
        parentId: "item-14",
        parentKey: "PAGE-14",
        parentTitle: "Login Seite erstellen",
        title: "UI erstellen",
        type: WORK_ITEM_TYPE.SUBTASK,
      }),
    });

    expect(screen.getByText(/Übergeordneter Task/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Subtasks/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "PAGE-14" }));
    expect(navigate).toHaveBeenCalledWith("/aufgaben/PAGE-14?from=kanban");
  });

  it("renders epics without parents", () => {
    renderDetail({
      children: [],
      parent: null,
      ticket: createTicket({
        id: "epic-9",
        key: "EPIC-9",
        parentId: null,
        parentKey: null,
        parentTitle: null,
        title: "Solo-Epic",
        type: WORK_ITEM_TYPE.EPIC,
      }),
    });

    expect(
      screen.getByLabelText("Initiative auswählen (optional)"),
    ).toHaveTextContent("Keine");
    expect(screen.queryByText("PAGE-3")).not.toBeInTheDocument();
  });

  it("shows submitting, archiving, and syncing navigation states", () => {
    const submitting = new FormData();
    submitting.append("intent", "create-task");
    mockedNavigation.mockReturnValue({
      formData: submitting,
      state: "submitting",
    } as unknown as ReturnType<typeof useNavigation>);
    renderDetail();
    expect(
      screen.getByRole("heading", { level: 1, name: "Login Seite erstellen" }),
    ).toBeInTheDocument();

    const archiving = new FormData();
    archiving.append("intent", "archive-task");
    mockedNavigation.mockReturnValue({
      formData: archiving,
      state: "submitting",
    } as unknown as ReturnType<typeof useNavigation>);
    renderDetail();
    expect(
      screen.getByRole("button", { name: "Wird archiviert …" }),
    ).toBeDisabled();

    const syncing = new FormData();
    syncing.append("intent", "sync-github-task");
    mockedNavigation.mockReturnValue({
      formData: syncing,
      state: "submitting",
    } as unknown as ReturnType<typeof useNavigation>);
    renderDetail({
      ticket: createTicket({
        githubIssueNumber: 42,
        githubIssueState: "open",
        githubIssueUrl: "https://github.com/user/pages/issues/42",
        githubLastSyncAt: "2026-09-05T15:00:00.000Z",
      }),
    });
    expect(
      screen.getByRole("button", { name: "Jetzt synchronisieren" }),
    ).toBeDisabled();
  });

  it("shows archived tickets with restore actions", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    renderDetail({
      ticket: createTicket({ archivedAt: "2026-09-05" }),
    });

    expect(screen.getAllByText("Archiviert").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Dieses Ticket ist archiviert und ausgeblendet, bis es wiederhergestellt wird.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Wiederherstellen" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Bearbeiten" })).toBeDisabled();

    await user.click(screen.getByRole("tab", { name: /Subtasks/ }));

    expect(
      screen.queryByRole("button", { name: "Unteraufgabe" }),
    ).not.toBeInTheDocument();
  });

  it("opens editors and the label picker", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(
      screen.getByRole("heading", { name: "Aufgabe bearbeiten" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    await user.click(screen.getByRole("tab", { name: /Subtasks/ }));
    await user.click(screen.getByRole("button", { name: "Unteraufgabe" }));
    expect(
      screen.getByRole("heading", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    await user.click(screen.getByRole("button", { name: "Labels bearbeiten" }));
    expect(screen.getByText("Labels auswählen")).toBeInTheDocument();
  });

  it("opens the move dialog from the details", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Verschieben" }));
    expect(
      screen.getByText("Ticket in anderes Projekt verschieben?"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(
      screen.queryByText("Ticket in anderes Projekt verschieben?"),
    ).not.toBeInTheDocument();
  });

  it("navigates to created and moved tickets", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    mockedActionData.mockReturnValue({
      intent: "create-task",
      key: "PAGE-15",
      ok: true,
    });

    renderDetail();

    expect(navigate).toHaveBeenCalledWith("/aufgaben/PAGE-15?from=kanban");
  });

  it("navigates to moved tickets and closes dialogs on updates", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    mockedActionData.mockReturnValue({
      intent: "move-project",
      key: "ASTRO-1",
      ok: true,
    });

    renderDetail();

    expect(navigate).toHaveBeenCalledWith("/aufgaben/ASTRO-1?from=kanban");
  });

  it("keeps failed restores on the page without navigation", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    mockedActionData.mockReturnValue({
      intent: "restore-task",
      ok: true,
    });

    renderDetail();

    expect(navigate).not.toHaveBeenCalled();
  });

  it("closes dialogs on keyless update actions", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    mockedActionData.mockReturnValue({
      intent: "update-task",
      key: "PAGE-14",
      ok: true,
    });

    renderDetail();

    expect(navigate).not.toHaveBeenCalled();
  });

  it("ignores keyed sync actions without navigation", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    mockedActionData.mockReturnValue({
      intent: "github-import-issue",
      key: "PAGE-99",
      ok: true,
    });

    renderDetail();

    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows action errors inside dialogs", async () => {
    const user = userEvent.setup();
    mockedNavigate.mockReturnValue(vi.fn());
    mockedActionData.mockReturnValue({
      error: "invalidInput",
      intent: "create-task",
      ok: false,
    });

    renderDetail();

    await user.click(screen.getByRole("tab", { name: /Subtasks/ }));
    await user.click(screen.getByRole("button", { name: "Unteraufgabe" }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders empty description and children states", async () => {
    const user = userEvent.setup();
    renderDetail({
      children: [],
      parent: null,
      ticket: createTicket({
        description: "",
        parentId: null,
        parentKey: null,
        parentTitle: null,
      }),
    });

    expect(screen.getAllByText("Keine").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: /Subtasks/ }));

    expect(screen.getAllByText("Keine").length).toBeGreaterThan(0);
  });
});
