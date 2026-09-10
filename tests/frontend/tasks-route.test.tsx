// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

import TasksRoute from "@/app/routes/tasks";
import { createI18n } from "@/app/lib/i18n";
import { GITHUB_SYNC_INTERVAL } from "@/definition/Project";
import { ROLE } from "@/definition/Role";
import {
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
  WORKFLOW_STATUS_KEY,
} from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { Project, ProjectIntegration } from "@/definition/Project";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
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

function createIntegration(): ProjectIntegration {
  return {
    hasToken: true,
    isConnected: true,
    lastSyncAt: null,
    nextSyncAt: null,
    projectId: "project-1",
    repoName: "user/pages",
    repoUrl: "https://github.com/user/pages",
    syncComments: false,
    syncCommits: false,
    syncDirection: "bidirectional",
    syncIntervalMinutes: GITHUB_SYNC_INTERVAL.EVERY_15_MINUTES,
    syncIssues: true,
    syncPullRequests: true,
    syncStatus: true,
    updatedAt: "2026-01-02",
  };
}

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
    assigneeName: "Admin",
    reporterName: "Reporter",
    completedAt: null,
    createdAt: "2026-01-01",
    createdBy: "user-1",
    description: "Details of ticket",
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
    title: "Kanban Board implementieren",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function renderTasks(loaderOverrides: Record<string, unknown> = {}): void {
  const i18n = createI18n(LANGUAGE.GERMAN);
  const router = createMemoryRouter(
    [
      {
        element: <TasksRoute />,
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
  );

  mockedLoaderData.mockReturnValue({
    actor: createUser(),
    archivedFilter: "active",
    assignees: [createUser()],
    assigneesByProject: {},
    milestones: [
      {
        archivedAt: null,
        completedAt: null,
        createdAt: "2026-01-01",
        description: "Milestone",
        dueAt: "2026-05-01",
        id: "milestone-1",
        name: "Pages v0.2",
        projectId: "project-1",
        startAt: "2026-01-01",
        status: "open",
        updatedAt: "2026-01-02",
      },
    ],
    projects: [
      createProject(),
      {
        ...createProject(),
        id: "project-2",
        name: "AstroLab",
      },
    ],
    selectedHistory: [],
    selectedItem: null,
    selectedPullRequests: [],
    selectedSubtasks: [],
    githubStates: [],
    labelUsageByProject: {},
    labelsByProject: {},
    labelsByWorkItem: {},
    statuses: createStatuses(),
    workItems: [
      createWorkItem(),
      createWorkItem({
        assigneeId: "user-2",
        id: "item-2",
        key: "ASTRO-31",
        milestoneId: null,
        milestoneName: null,
        priority: WORK_ITEM_PRIORITY.NORMAL,
        projectId: "project-2",
        projectName: "AstroLab",
        statusId: "status-in-progress",
        title: "MCP reparieren",
      }),
    ],
    ...loaderOverrides,
  });

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("TasksRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedActionData.mockReturnValue(undefined);
    mockedNavigate.mockReturnValue(vi.fn());
    mockedNavigation.mockReturnValue({
      formData: undefined,
      state: "idle",
    } as unknown as ReturnType<typeof useNavigation>);
  });

  it("renders header and default kanban view with user tasks", () => {
    renderTasks();

    expect(
      screen.getByRole("heading", { name: "Aufgaben" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Behalte deine Aufgaben über alle Projekte hinweg im Blick.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();

    expect(screen.getByText("PAGE-12")).toBeInTheDocument();
    expect(screen.queryByText("ASTRO-31")).not.toBeInTheDocument();
  });

  it("switches filter scope to all tasks", async () => {
    const user = userEvent.setup();
    renderTasks();

    await user.click(screen.getByRole("button", { name: "Alle Aufgaben" }));

    expect(screen.getByText("PAGE-12")).toBeInTheDocument();
    expect(screen.getByText("ASTRO-31")).toBeInTheDocument();
  });

  it("switches view mode between kanban and list", async () => {
    const user = userEvent.setup();
    renderTasks();

    await user.click(screen.getByRole("button", { name: "Liste" }));

    expect(screen.getByRole("table")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Kanban" }));

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("switches filter scope back to user tasks", async () => {
    const user = userEvent.setup();
    renderTasks();

    await user.click(screen.getByRole("button", { name: "Alle Aufgaben" }));
    expect(screen.getByText("ASTRO-31")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Meine Aufgaben" }));
    expect(screen.queryByText("ASTRO-31")).not.toBeInTheDocument();
    expect(screen.getByText("PAGE-12")).toBeInTheDocument();
  });

  it("filters tasks by search query", async () => {
    const user = userEvent.setup();
    renderTasks();

    await user.click(screen.getByRole("button", { name: "Alle Aufgaben" }));
    const searchInput = screen.getByPlaceholderText("Aufgaben suchen …");

    await user.type(searchInput, "MCP");

    expect(screen.queryByText("PAGE-12")).not.toBeInTheDocument();
    expect(screen.getByText("ASTRO-31")).toBeInTheDocument();
  });

  it("filters tasks by project, type, status, priority, and milestone dropdowns", async () => {
    const user = userEvent.setup();
    renderTasks();

    await user.click(screen.getByRole("button", { name: "Alle Aufgaben" }));

    const selects = screen.getAllByRole("combobox");
    const projectSelect = selects[0] as HTMLElement;
    const typeSelect = selects[1] as HTMLElement;
    const statusSelect = selects[2] as HTMLElement;
    const prioritySelect = selects[3] as HTMLElement;
    const milestoneSelect = selects[4] as HTMLElement;

    await user.click(projectSelect);
    await user.click(await screen.findByRole("option", { name: "AstroLab" }));
    await waitFor(() => expect(projectSelect).toHaveTextContent("AstroLab"));
    expect(screen.queryByText("PAGE-12")).not.toBeInTheDocument();
    expect(screen.getByText("ASTRO-31")).toBeInTheDocument();

    await user.click(projectSelect);
    await user.click(
      await screen.findByRole("option", { name: "Alle Projekte" }),
    );
    await waitFor(() =>
      expect(projectSelect).toHaveTextContent("Alle Projekte"),
    );
    await user.click(typeSelect);
    await user.click(await screen.findByRole("option", { name: "Epic" }));
    await waitFor(() => expect(typeSelect).toHaveTextContent("Epic"));
    expect(screen.queryByText("PAGE-12")).not.toBeInTheDocument();

    await user.click(typeSelect);
    await user.click(await screen.findByRole("option", { name: "Alle Typen" }));
    await waitFor(() => expect(typeSelect).toHaveTextContent("Alle Typen"));
    await user.click(statusSelect);
    await user.click(await screen.findByRole("option", { name: "To Do" }));
    await waitFor(() => expect(statusSelect).toHaveTextContent("To Do"));
    expect(screen.getByText("PAGE-12")).toBeInTheDocument();
    expect(screen.queryByText("ASTRO-31")).not.toBeInTheDocument();

    await user.click(statusSelect);
    await user.click(
      await screen.findByRole("option", { name: "Alle Status" }),
    );
    await waitFor(() => expect(statusSelect).toHaveTextContent("Alle Status"));
    await user.click(prioritySelect);
    await user.click(await screen.findByRole("option", { name: "Hoch" }));
    await waitFor(() => expect(prioritySelect).toHaveTextContent("Hoch"));
    expect(screen.getByText("PAGE-12")).toBeInTheDocument();

    await user.click(prioritySelect);
    await user.click(
      await screen.findByRole("option", { name: "Alle Prioritäten" }),
    );
    await waitFor(() =>
      expect(prioritySelect).toHaveTextContent("Alle Prioritäten"),
    );
    await user.click(milestoneSelect);
    await user.click(await screen.findByRole("option", { name: "Pages v0.2" }));
    await waitFor(() =>
      expect(milestoneSelect).toHaveTextContent("Pages v0.2"),
    );
    expect(screen.getByText("PAGE-12")).toBeInTheDocument();
  });

  it("displays empty state when no tasks exist across projects", () => {
    renderTasks({ workItems: [] });

    expect(screen.getByText("Noch keine Aufgaben")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Erstelle deine erste Aufgabe und beginne mit der Planung.",
      ),
    ).toBeInTheDocument();
  });

  it("displays no matches message when filter excludes all tasks", async () => {
    const user = userEvent.setup();
    renderTasks();

    const searchInput = screen.getByPlaceholderText("Aufgaben suchen …");
    await user.type(searchInput, "NonexistentQueryxyz");

    expect(
      screen.getByText("Keine Aufgaben entsprechen diesem Filter."),
    ).toBeInTheDocument();
  });

  it("renders detail panel when selectedItem is provided by loader", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks({
      selectedItem: createWorkItem(),
    });

    expect(
      screen.getByRole("dialog", {
        name: "PAGE-12 Kanban Board implementieren",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(navigate).toHaveBeenCalledWith("?");
  });

  it("opens create dialog on button click", async () => {
    const user = userEvent.setup();
    renderTasks();

    await user.click(screen.getByRole("button", { name: "Neue Aufgabe" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();
  });

  it("handles successful action response navigation", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    mockedActionData.mockReturnValue({
      intent: "create-task",
      key: "PAGE-15",
      ok: true,
    });

    renderTasks();

    expect(navigate).toHaveBeenCalledWith("?item=PAGE-15");
  });

  it("navigates to the moved ticket after project moves", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    mockedActionData.mockReturnValue({
      intent: "move-project",
      key: "ASTRO-1",
      ok: true,
    });

    renderTasks();

    expect(navigate).toHaveBeenCalledWith("?item=ASTRO-1");

    mockedActionData.mockReturnValue({
      intent: "move-project",
      ok: true,
    });

    renderTasks();

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("changes the archived filter through the toolbar select", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks();

    await user.click(screen.getByRole("combobox", { name: "Archiv-Status" }));
    await user.click(await screen.findByRole("option", { name: "Archiviert" }));

    expect(navigate).toHaveBeenCalledWith("?archived=archived");
  });

  it("opens tickets in the full view on double click", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks();

    await user.dblClick(
      screen.getByRole("heading", {
        level: 4,
        name: "Kanban Board implementieren",
      }),
    );

    expect(navigate).toHaveBeenCalledWith("?item=PAGE-12");
  });

  it("switches to hierarchy, milestones, and github views", async () => {
    const user = userEvent.setup();
    renderTasks({
      githubStates: [
        {
          externalIssues: [],
          integration: createIntegration(),
          project: createProject(),
          pullRequests: [],
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Hierarchie" }));
    expect(screen.getByText("Kanban Board implementieren")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Alle aufklappen" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Meilensteine" }));
    expect(
      screen.getByRole("heading", { name: "Pages v0.2" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "GitHub" }));
    expect(screen.getByText("Keine neuen Issues erkannt.")).toBeInTheDocument();
  });

  it("renders the compact GitHub state of the detail panel", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks({
      selectedItem: createWorkItem({
        githubIssueNumber: 82,
        githubIssueState: "open",
        githubIssueUrl: "https://github.com/user/pages/issues/82",
        githubLastSyncAt: "2026-09-05 14:21",
      }),
    });

    const panel = screen.getByRole("dialog", {
      name: "PAGE-12 Kanban Board implementieren",
    });
    expect(within(panel).getByText("Git Status")).toBeInTheDocument();
    expect(within(panel).getByText("Synchronisiert")).toBeInTheDocument();
  });

  it("renders failed sync states for conflicted tasks", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks({
      selectedItem: createWorkItem({
        githubConflict: true,
        githubIssueNumber: 82,
        githubIssueState: "open",
        githubIssueUrl: "https://github.com/user/pages/issues/82",
        githubLastSyncAt: "2026-09-05 14:21",
      }),
    });

    expect(screen.getByText("Sync fehlgeschlagen")).toBeInTheDocument();
  });

  it("selects kanban cards and edits tasks through the detail panel", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks({
      selectedItem: createWorkItem(),
    });

    await user.click(
      screen.getByRole("heading", {
        level: 4,
        name: "Kanban Board implementieren",
      }),
    );
    expect(navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(
      screen.getByRole("heading", { name: "Aufgabe bearbeiten" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(
      screen.queryByRole("heading", { name: "Aufgabe bearbeiten" }),
    ).not.toBeInTheDocument();
  });

  it("creates subtasks from the detail panel section", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks({
      selectedItem: createWorkItem(),
      selectedSubtasks: [createWorkItem({ id: "sub-1", key: "PAGE-13" })],
    });

    await user.click(screen.getByRole("button", { name: "Unteraufgabe" }));

    expect(
      screen.getByRole("heading", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();
  });

  it("creates tasks from epics through the detail panel", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks({
      selectedItem: createWorkItem({ type: WORK_ITEM_TYPE.EPIC }),
      selectedSubtasks: [],
    });

    const panel = screen.getByRole("dialog", {
      name: "PAGE-12 Kanban Board implementieren",
    });

    await user.click(
      within(panel).getByRole("button", { name: "Neue Aufgabe" }),
    );

    expect(
      screen.getByRole("heading", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();
  });

  it("quick-creates tasks from board columns", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks();

    await user.click(
      screen.getByRole("button", { name: "Neue Aufgabe (To Do)" }),
    );

    expect(
      screen.getByRole("heading", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();
  });

  it("moves tasks via drag and drop", async () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    const submit = vi.fn();
    mockedSubmit.mockReturnValue(submit);

    renderTasks();

    const card = screen.getByText("Kanban Board implementieren");
    const dataTransfer = {
      getData: vi.fn().mockReturnValue("item-1"),
      setData: vi.fn(),
    };

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(screen.getByRole("heading", { name: "In Arbeit" }), {
      dataTransfer,
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "move-task" }),
      { method: "post" },
    );
  });

  it("shows submitting, archiving, and syncing states", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    const submitting = new FormData();
    submitting.append("intent", "create-task");
    mockedNavigation.mockReturnValue({
      formData: submitting,
      state: "submitting",
    } as unknown as ReturnType<typeof useNavigation>);

    renderTasks({
      selectedItem: createWorkItem(),
    });

    await user.click(screen.getByRole("button", { name: "Neue Aufgabe" }));

    expect(
      screen.getByRole("button", { name: "Wird erstellt …" }),
    ).toBeInTheDocument();

    const archiving = new FormData();
    archiving.append("intent", "archive-task");
    mockedNavigation.mockReturnValue({
      formData: archiving,
      state: "submitting",
    } as unknown as ReturnType<typeof useNavigation>);

    renderTasks({
      selectedItem: createWorkItem(),
    });

    expect(
      screen.getByRole("button", { name: "Wird archiviert …" }),
    ).toBeInTheDocument();

    const syncing = new FormData();
    syncing.append("intent", "sync-github-task");
    mockedNavigation.mockReturnValue({
      formData: syncing,
      state: "submitting",
    } as unknown as ReturnType<typeof useNavigation>);

    renderTasks({
      selectedItem: createWorkItem({
        githubIssueNumber: 82,
        githubIssueState: "open",
        githubIssueUrl: "https://github.com/user/pages/issues/82",
        githubLastSyncAt: "2026-09-05 14:21",
      }),
      selectedPullRequests: [],
    });

    expect(screen.getByText("Synchronisiert")).toBeInTheDocument();
  });

  it("navigates on archive and import actions", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    mockedActionData.mockReturnValue({
      intent: "archive-task",
      ok: true,
    });

    renderTasks();

    expect(navigate).toHaveBeenCalledWith("?");

    mockedActionData.mockReturnValue({
      intent: "github-import-issue",
      key: "PAGE-99",
      ok: true,
    });

    renderTasks();

    expect(navigate).toHaveBeenCalledWith("?item=PAGE-99");
  });

  it("closes dialogs on keyless update actions", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    mockedActionData.mockReturnValue({
      intent: "update-task",
      ok: true,
    });

    renderTasks();

    expect(navigate).not.toHaveBeenCalled();
  });

  it("ignores successful sync actions without navigation", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    mockedActionData.mockReturnValue({
      intent: "sync-github-project",
      ok: true,
    });

    renderTasks();

    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows action errors inside an open dialog", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    mockedActionData.mockReturnValue({
      error: "invalidInput",
      intent: "create-task",
      ok: false,
    });

    renderTasks();

    await user.click(screen.getByRole("button", { name: "Neue Aufgabe" }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("filters milestones and github states by project", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks({
      githubStates: [
        {
          externalIssues: [],
          integration: createIntegration(),
          project: createProject(),
          pullRequests: [],
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Alle Aufgaben" }));
    await user.click(screen.getByRole("button", { name: "Meilensteine" }));

    const selects = screen.getAllByRole("combobox");
    await user.click(selects[0] as HTMLElement);
    await user.click(await screen.findByRole("option", { name: "AstroLab" }));
    expect(screen.getByText("Noch keine Meilensteine.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "GitHub" }));
    expect(screen.getByText("Keine Projekte verfügbar.")).toBeInTheDocument();
  });

  it("sorts the list view by clickable columns", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks();

    await user.click(screen.getByRole("button", { name: "Liste" }));
    await user.click(screen.getByText("Projekt"));
    await user.click(screen.getByText("Titel"));
    await user.click(screen.getByText("Status"));
    await user.click(screen.getByText("Priorität"));
    await user.click(screen.getByText("Fällig am"));

    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("finds tasks by key search", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks();

    await user.click(screen.getByRole("button", { name: "Alle Aufgaben" }));
    await user.type(
      screen.getByPlaceholderText("Aufgaben suchen …"),
      "PAGE-12",
    );

    expect(screen.getByText("PAGE-12")).toBeInTheDocument();
    expect(screen.queryByText("ASTRO-31")).not.toBeInTheDocument();
  });

  it("hides the milestone filter without milestones", () => {
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks({ milestones: [] });

    expect(screen.getAllByRole("combobox")).toHaveLength(5);
  });

  it("prefills the project when creating from a filtered board", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks();

    await user.click(screen.getByRole("button", { name: "Alle Aufgaben" }));

    const selects = screen.getAllByRole("combobox");
    await user.click(selects[0] as HTMLElement);
    await user.click(await screen.findByRole("option", { name: "AstroLab" }));
    await user.click(
      screen.getByRole("button", { name: "Neue Aufgabe (To Do)" }),
    );

    expect(
      screen.getByRole("heading", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await user.click(screen.getByRole("button", { name: "Neue Aufgabe" }));

    expect(
      screen.getByRole("heading", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();
  });

  it("sorts the list view through every sortable column", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);

    renderTasks();

    await user.click(screen.getByRole("button", { name: "Alle Aufgaben" }));
    await user.click(screen.getByRole("button", { name: "Liste" }));
    await user.click(screen.getByText("Priorität"));
    await user.click(screen.getByText("Fällig am"));

    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
