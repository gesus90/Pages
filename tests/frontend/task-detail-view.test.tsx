// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import { createUser } from "../helpers/factories";

import type { Project } from "@/definition/Project";
import type {
  Milestone,
  Label,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";

const mockedActionData = vi.mocked(useActionData);
const mockedLoaderData = vi.mocked(useLoaderData);
const mockedNavigate = vi.mocked(useNavigate);
const mockedNavigation = vi.mocked(useNavigation);
const mockedSubmit = vi.mocked(useSubmit);

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    createdAt: "2026-01-01",
    description: "Pages",
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
    departmentId: null,
    archivedAt: null,
    assigneeId: "user-1",
    assigneeGroupId: null,
    assigneeName: "Admin",
    assigneeGroupName: null,
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

function createLabel(): Label {
  return {
    color: "#3b82f6",
    createdAt: "2026-01-01",
    id: "label-1",
    name: "Feature",
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

/** What the ticket fetchers posted to the shared ticket action. */
let fetcherSubmissions: Record<string, FormDataEntryValue>[] = [];

function renderDetail(loaderOverrides: Record<string, unknown> = {}): void {
  mockedLoaderData.mockReturnValue({
    actor: createUser(),
    assigneeGroupIdsByProject: { "project-1": ["group-1"] },
    assigneeGroups: [
      { id: "group-1", memberCount: 2, name: "Design" },
      { id: "group-2", memberCount: 0, name: "Leer" },
    ],
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
    attachments: [],
    checklist: [],
    descendants: {
      active: { epic: 0, initiative: 0, subtask: 1, task: 0 },
      all: { epic: 0, initiative: 0, subtask: 1, task: 0 },
    },
    links: [],
    children: [
      createTicket({
        id: "sub-1",
        key: "PAGE-14.1",
        parentId: "item-14",
        title: "UI erstellen",
        type: WORK_ITEM_TYPE.SUBTASK,
      }),
    ],
    departmentChoices: {
      available: [
        { id: "department-1", name: "Entwicklung" },
        { id: "department-2", name: "Support" },
      ],
    },
    fromView: "kanban",
    permissions: { canDelete: false, canWrite: true },
    templates: [],
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
    labels: [createLabel()],
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
    [
      { element: <TaskDetailRoute />, path: "/" },
      {
        async action({ request }) {
          fetcherSubmissions.push(Object.fromEntries(await request.formData()));

          return { intent: "change-parent", ok: true };
        },
        path: "/aufgaben",
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

describe("TaskDetailRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetcherSubmissions = [];
    mockedActionData.mockReturnValue(undefined);
    mockedNavigate.mockReturnValue(vi.fn());
    mockedNavigation.mockReturnValue({
      formData: undefined,
      state: "idle",
    } as unknown as ReturnType<typeof useNavigation>);
    mockedSubmit.mockReturnValue(vi.fn());
  });

  it("renders the Jira-like full view with path, description, children and activity", () => {
    renderDetail();

    expect(
      screen.getByRole("heading", { level: 1, name: "Login Seite erstellen" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("PAGE-14").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("link", { name: "Aufgaben" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Projektverwaltung" }),
    ).toHaveAttribute("href", "/aufgaben/PAGE-3?from=kanban");
    expect(screen.getByText("Login umsetzen")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Subtasks/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("UI erstellen")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Aktivität" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Anhänge/ })).toBeVisible();
    expect(screen.getAllByLabelText("Status")).toHaveLength(1);
  });

  it("saves the title edited in place and refreshes after an upload", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const answers: (() => void)[] = [];

    class UploadRequest {
      public status = 200;
      public responseText = JSON.stringify({
        attachment: { fileName: "a.txt", id: "a9", isEmbeddable: false },
      });
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public upload = { onprogress: null };
      public open(): void {}
      public send(): void {
        answers.push(() => this.onload?.());
        queueMicrotask(() => this.onload?.());
      }
    }

    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    mockedSubmit.mockReturnValue(submit);
    renderDetail();

    await user.dblClick(
      screen.getByRole("heading", { level: 1, name: "Login Seite erstellen" }),
    );
    const titleInput = screen.getByDisplayValue("Login Seite erstellen");

    await user.clear(titleInput);
    await user.type(titleInput, "Neuer Titel{Enter}");
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "update-task", title: "Neuer Titel" }),
      { method: "post" },
    );

    const input = document.querySelector<HTMLInputElement>(
      'section > input[type="file"]',
    );

    await user.upload(input as HTMLInputElement, new File(["x"], "a.txt"));
    await waitFor(() => expect(answers).toHaveLength(1));
    vi.unstubAllGlobals();
  });

  it("navigates back and opens child tickets", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mockedNavigate.mockReturnValue(navigate);
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Zurück zum Board" }));
    expect(navigate).toHaveBeenCalledWith("/aufgaben?view=kanban");
    expect(screen.getByRole("link", { name: /UI erstellen/ })).toHaveAttribute(
      "href",
      "/aufgaben/PAGE-14.1?from=kanban",
    );
  });

  it("submits status, field and parent changes", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    mockedSubmit.mockReturnValue(submit);
    renderDetail();

    await user.click(screen.getByLabelText("Status"));
    await user.click(await screen.findByRole("option", { name: "Done" }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "move-task" }),
      { method: "post" },
    );

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

    await user.click(screen.getByLabelText("Meilenstein"));
    await user.click(await screen.findByRole("option", { name: "MVP" }));

    fireEvent.change(screen.getByLabelText("Fällig am"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("Startdatum"), {
      target: { value: "2026-09-01" },
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "update-task", priority: "urgent" }),
      { method: "post" },
    );
    expect(submit).toHaveBeenCalledWith(
      expect.not.objectContaining({ description: expect.anything() }),
      { method: "post" },
    );

    await user.click(screen.getByLabelText("Epic"));
    await user.click(
      await screen.findByRole("option", { name: "PAGE-99: Eigenes Epic" }),
    );
    await waitFor(() =>
      expect(fetcherSubmissions.at(-1)).toMatchObject({
        id: "item-14",
        intent: "change-parent",
        parentId: "self-epic",
      }),
    );
  });

  it("submits quick edits with empty fallbacks for tickets without relations", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    mockedSubmit.mockReturnValue(submit);
    renderDetail({
      ticket: createTicket({
        assigneeId: null,
        assigneeGroupId: null,
        assigneeName: null,
        assigneeGroupName: null,
        dueAt: null,
        milestoneId: null,
        milestoneName: null,
        parentId: null,
        parentKey: null,
        parentTitle: null,
        startAt: null,
      }),
    });

    await user.click(screen.getByLabelText("Priorität"));
    await user.click(await screen.findByRole("option", { name: "Dringend" }));

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: "",
        assigneeGroupId: "",
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

    expect(
      screen.getByRole("heading", { name: /Enthaltene Tasks/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Projekt erstellen")).toBeInTheDocument();
    expect(screen.getByLabelText("Initiative")).toHaveTextContent(
      "PAGE-1: Plattform",
    );
    expect(screen.getByText("1 / 2 (50 %)")).toBeInTheDocument();

    const [headerAdd] = screen.getAllByRole("button", {
      name: "Task hinzufügen",
    });

    await user.click(headerAdd as HTMLElement);
    expect(
      screen.getByRole("heading", { name: "Neue Aufgabe" }),
    ).toBeInTheDocument();
  });

  it("assigns an initiative to an epic through the sidebar", async () => {
    const user = userEvent.setup();
    renderDetail({
      projectWorkItems: [
        createTicket({
          id: "init-2",
          key: "PAGE-2",
          title: "Zweite Initiative",
          type: WORK_ITEM_TYPE.INITIATIVE,
        }),
      ],
      ticket: createTicket({
        id: "epic-1",
        key: "EPIC-1",
        parentId: null,
        parentKey: null,
        parentTitle: null,
        type: WORK_ITEM_TYPE.EPIC,
      }),
    });

    await user.click(screen.getByLabelText("Initiative"));
    await user.click(
      await screen.findByRole("option", { name: "PAGE-2: Zweite Initiative" }),
    );

    await waitFor(() =>
      expect(fetcherSubmissions.at(-1)).toMatchObject({
        id: "epic-1",
        intent: "change-parent",
        parentId: "init-2",
      }),
    );
  });

  it("copies the ticket link and shows the address without clipboard access", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("denied"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Link kopieren" }));
    expect(await screen.findByText("Link kopiert")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/aufgaben/PAGE-14`,
    );

    await user.click(screen.getByRole("button", { name: "Link kopieren" }));
    expect(
      await screen.findByText(`${window.location.origin}/aufgaben/PAGE-14`),
    ).toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
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

    expect(
      screen.getByRole("heading", { name: /Enthaltene Epics/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Projektverwaltung")).toBeInTheDocument();
    expect(screen.queryByLabelText("Initiative")).not.toBeInTheDocument();

    const [sectionAdd] = screen
      .getAllByRole("button", { name: "Epic hinzufügen" })
      .slice(-1);

    await user.click(sectionAdd as HTMLElement);
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
        assigneeGroupId: null,
        assigneeName: null,
        assigneeGroupName: null,
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

    expect(screen.getByLabelText("Task")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Subtasks/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /hinzufügen/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "PAGE-14 öffnen" }));
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

    expect(screen.getByLabelText("Initiative")).toHaveTextContent(
      "Keine Zuordnung",
    );
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
    expect(
      screen.queryByRole("button", { name: "Subtask hinzufügen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Beschreibung bearbeiten" }),
    ).not.toBeInTheDocument();
    void user;
  });

  it("keeps the metadata of active tickets read-only without write access", () => {
    renderDetail({ permissions: { canDelete: false, canWrite: false } });

    const fields = screen.getAllByRole("combobox");

    expect(fields.length).toBeGreaterThan(0);

    for (const field of fields) {
      expect(field).toBeDisabled();
    }

    const dates = document.querySelectorAll('input[type="date"]');

    expect(dates).toHaveLength(2);

    for (const date of dates) {
      expect(date).toBeDisabled();
    }

    expect(
      screen.queryByRole("button", { name: "Labels bearbeiten" }),
    ).not.toBeInTheDocument();
  });

  it("hides restore controls and explains read-only access on archived tickets", () => {
    mockedNavigate.mockReturnValue(vi.fn());
    renderDetail({
      permissions: { canDelete: false, canWrite: false },
      ticket: createTicket({ archivedAt: "2026-09-05" }),
    });

    expect(
      screen.queryByRole("button", { name: "Wiederherstellen" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/nur Leserechte/)).toBeInTheDocument();
  });

  it("offers permanent deletion alone to administrators without write access", async () => {
    const user = userEvent.setup();
    mockedNavigate.mockReturnValue(vi.fn());
    mockedActionData.mockReturnValue({
      error: "invalidInput",
      intent: "create-task",
      ok: false,
    });
    renderDetail({ permissions: { canDelete: true, canWrite: false } });

    expect(
      screen.queryByRole("button", { name: "Archivieren" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Endgültig löschen" }));

    expect(document.querySelector('input[name="redirectTo"]')).toHaveAttribute(
      "value",
      "/aufgaben?view=kanban",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores successful outcomes inside the delete dialog", async () => {
    const user = userEvent.setup();
    mockedNavigate.mockReturnValue(vi.fn());
    mockedActionData.mockReturnValue({ intent: "delete-task", ok: true });
    renderDetail({ permissions: { canDelete: true, canWrite: true } });

    await user.click(screen.getByRole("button", { name: "Endgültig löschen" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

    await user.click(
      screen.getAllByRole("button", {
        name: "Subtask hinzufügen",
      })[1] as HTMLElement,
    );
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

    await user.click(
      screen.getAllByRole("button", {
        name: "Subtask hinzufügen",
      })[0] as HTMLElement,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders the ticket description as markdown with a Wiki hotlink", async () => {
    const user = userEvent.setup();
    renderDetail({
      ticket: createTicket({
        description: "## Plan\n\nSee [idea](/wiki/ideas) and **more**.",
      }),
    });

    void user;

    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /idea/ })).toHaveAttribute(
      "href",
      "/wiki/ideas",
    );
  });

  it("renders empty description and children states", () => {
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

    expect(
      screen.getByRole("button", { name: "Beschreibung hinzufügen …" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Keine untergeordneten Einträge."),
    ).toBeInTheDocument();
    expect(screen.getByText("Noch keine Anhänge.")).toBeInTheDocument();
  });
});
