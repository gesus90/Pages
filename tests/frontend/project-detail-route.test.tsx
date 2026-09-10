// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useLoaderData: vi.fn(),
    useNavigation: vi.fn(),
    useSearchParams: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";

import ProjectDetailRoute from "@/app/routes/project-detail";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type { Project } from "@/definition/Project";
import type { Milestone, WorkItemDetail } from "@/definition/Task";

const mockedLoaderData = vi.mocked(useLoaderData);
const mockedSearchParams = vi.mocked(useSearchParams);
const mockedNavigation = vi.mocked(useNavigation);

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    createdAt: "2026-01-01",
    description: "Central platform for internal tools.",
    hasIcon: false,
    id: "project-1",
    managerId: null,
    managerName: "Alex Berger",
    name: "Pages",
    notes: "Key decisions live here.",
    parentId: null,
    placeholderColor: "#FCE3D3",
    progress: 62,
    startDate: "2026-09-05",
    status: "active",
    targetDate: "2026-12-15T12:00:00",
    updatedAt: "2026-09-05",
    ...overrides,
  };
}

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
    priority: "normal",
    progressPercentage: 0,
    projectId: "project-1",
    projectName: "Pages",
    sortOrder: 1,
    startAt: null,
    statusId: "status-in-progress",
    statusKey: "in_progress",
    statusName: "In Arbeit",
    subtaskCompleted: 0,
    subtaskTotal: 0,
    title: "Login",
    type: "task",
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

function createLoaderData(overrides: Record<string, unknown> = {}) {
  return {
    activeTab: "general",
    activity: [
      {
        action: "member_added",
        category: "team",
        createdAt: "2026-09-05 15:00",
        id: "activity-1",
        message: "Anna was added to the project.",
        projectId: "project-1",
        userDisplayName: "Alex",
        userId: "user-1",
      },
    ],
    canWrite: true,
    eligibleUsers: [
      {
        displayName: "Anna",
        id: "user-2",
        isActive: true,
        role: "employee",
        username: "anna",
      },
    ],
    events: [
      {
        createdAt: "2026-01-01",
        description: "",
        eventDate: "2026-09-12",
        eventTime: "10:00",
        id: "event-1",
        projectId: "project-1",
        title: "Projektbesprechung",
        type: "meeting",
        updatedAt: "2026-01-01",
      },
      {
        createdAt: "2026-01-01",
        description: "",
        eventDate: "2026-09-30",
        eventTime: null,
        id: "event-2",
        projectId: "project-1",
        title: "MVP",
        type: "milestone",
        updatedAt: "2026-01-01",
      },
    ],
    goals: [
      {
        id: "goal-1",
        isDone: false,
        position: 0,
        projectId: "project-1",
        title: "Moderne Oberfläche fertigstellen",
      },
      {
        id: "goal-2",
        isDone: true,
        position: 1,
        projectId: "project-1",
        title: "Abgeschlossenes Ziel",
      },
    ],
    integration: null,
    members: [
      {
        displayName: "Alex Berger",
        joinedAt: "2026-01-01",
        projectRole: "manager",
        userId: "user-1",
        username: "alex",
      },
      {
        displayName: "Anna",
        joinedAt: "2026-01-02",
        projectRole: "member",
        userId: "user-2",
        username: "anna",
      },
    ],
    milestones: [createMilestone()],
    statuses: [],
    tags: ["Web", "Plattform"],
    taskHistory: [
      {
        action: "status_changed",
        createdAt: "2026-09-05 14:21",
        field: "status",
        id: "history-1",
        newValue: "In Arbeit",
        oldValue: "To Do",
        userDisplayName: "Alex",
        userId: "user-1",
        workItemId: "item-1",
      },
    ],
    workItems: [
      createWorkItem(),
      createWorkItem({
        id: "item-2",
        isDone: true,
        key: "PAGE-13",
        milestoneId: "milestone-1",
        parentId: null,
        statusId: "status-done",
        statusKey: "done",
        statusName: "Done",
        title: "Dashboard",
      }),
      createWorkItem({
        id: "item-3",
        key: "PAGE-14",
        milestoneId: null,
        parentId: "item-1",
        title: "Formular erstellen",
        type: "subtask",
      }),
    ],
    project: createProject(),
    ...overrides,
  };
}

function renderDetail(
  loaderData: Record<string, unknown>,
  initialTab: string | null = null,
  navigation: Record<string, unknown> | null = null,
): ReturnType<typeof render> {
  mockedLoaderData.mockReturnValue(loaderData);
  mockedNavigation.mockReturnValue(
    (navigation ?? { state: "idle" }) as ReturnType<typeof useNavigation>,
  );
  mockedSearchParams.mockImplementation(() => {
    const [params, setParams] = useState(
      new URLSearchParams(initialTab ? `tab=${initialTab}` : ""),
    );
    const setSearchParamsRef =
      useRef<(next: Record<string, string>) => void>(undefined);

    if (!setSearchParamsRef.current) {
      setSearchParamsRef.current = vi.fn((next: Record<string, string>) => {
        setParams(new URLSearchParams(next));
      });
    }

    return [params, setSearchParamsRef.current] as unknown as ReturnType<
      typeof useSearchParams
    >;
  });
  const i18n = createI18n(LANGUAGE.GERMAN);
  const router = createMemoryRouter(
    [{ element: <ProjectDetailRoute />, path: "/projekte/:projectId" }],
    { initialEntries: ["/projekte/project-1"] },
  );

  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("ProjectDetailRoute", () => {
  it("renders the header, all five tabs, and no settings button", () => {
    renderDetail(createLoaderData());

    expect(screen.getByText("Projekt: Pages")).toBeInTheDocument();
    expect(screen.getAllByText("Aktiv")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "Allgemein" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Planung" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Integrationen" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Aktivität" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Einstellungen" }),
    ).not.toBeInTheDocument();
  });

  it("shows the description as the dominant general panel with goals and progress", () => {
    renderDetail(createLoaderData());

    expect(screen.getByText("Projektbeschreibung")).toBeInTheDocument();
    expect(
      screen.getAllByText("Central platform for internal tools."),
    ).toHaveLength(2);
    expect(screen.getByText("Projektziele")).toBeInTheDocument();
    expect(
      screen.getByText("Moderne Oberfläche fertigstellen"),
    ).toBeInTheDocument();
    expect(screen.getByText("Fortschritt")).toBeInTheDocument();
    expect(screen.getByText("Nächste Termine")).toBeInTheDocument();
    expect(screen.getByText("Projektbesprechung")).toBeInTheDocument();
    expect(screen.getByText("Projektdetails")).toBeInTheDocument();
    expect(screen.getByText("Alex Berger")).toBeInTheDocument();
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("Key decisions live here.")).toBeInTheDocument();
  });

  it("manages team members grouped by project role", async () => {
    const user = userEvent.setup();
    renderDetail(createLoaderData(), "team");

    expect(screen.getAllByText("Projektmanager").length).toBeGreaterThan(0);
    expect(screen.getByText("Mitglieder")).toBeInTheDocument();
    expect(screen.getAllByText("Betrachter").length).toBeGreaterThan(0);
    expect(screen.getByText("Alex Berger")).toBeInTheDocument();
    expect(screen.getAllByText("Anna").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "+ Mitglied hinzufügen" }),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText("+ Mitglied hinzufügen"));
    await user.click(await screen.findByRole("option", { name: "Anna" }));
  });

  it("shows planning sections with milestone progress computed from tasks", async () => {
    const user = userEvent.setup();
    renderDetail(createLoaderData(), "planning");

    expect(screen.getByText("MVP")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 Aufgaben")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Termine" }));
    expect(screen.getByText("Projektbesprechung")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Aufgabenstruktur" }));
    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(screen.getByText("Formular erstellen")).toBeInTheDocument();
  });

  it("configures GitHub without ever exposing the stored token", () => {
    renderDetail(
      createLoaderData({
        integration: {
          hasToken: true,
          isConnected: true,
          lastSyncAt: "2026-09-05 14:21",
          nextSyncAt: "2026-09-05 14:36",
          projectId: "project-1",
          repoName: "user/pages",
          repoUrl: "https://github.com/user/pages.git",
          syncComments: true,
          syncCommits: false,
          syncDirection: "bidirectional",
          syncIntervalMinutes: 15,
          syncIssues: true,
          syncPullRequests: false,
          syncStatus: true,
          updatedAt: "2026-09-05",
        },
      }),
      "integrations",
    );

    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://github.com/user/pages.git"),
    ).toBeInTheDocument();
    expect(screen.getByText("✓ API-Key hinterlegt")).toBeInTheDocument();
    expect(screen.getByText("Verbunden")).toBeInTheDocument();
    expect(screen.getByText("user/pages")).toBeInTheDocument();
    expect(screen.getByText("Aktualisierungsintervall")).toBeInTheDocument();
    expect(screen.getByText("2026-09-05 14:36")).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("ghp-secret-token"),
    ).not.toBeInTheDocument();
  });

  it("shows the chronological activity log with filters", () => {
    renderDetail(createLoaderData(), "activity");

    expect(screen.getAllByText("Alle Aktivitäten")).toHaveLength(2);
    expect(screen.getAllByText("Alle Personen")).toHaveLength(2);
    expect(
      screen.getByText("Anna was added to the project."),
    ).toBeInTheDocument();
  });

  it("hides write controls from readers", () => {
    renderDetail(createLoaderData({ canWrite: false }), "team");

    expect(
      screen.queryByRole("button", { name: "+ Mitglied hinzufügen" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the tablist usable", () => {
    renderDetail(createLoaderData());

    const tablist = screen.getByRole("tablist");
    expect(within(tablist).getAllByRole("tab")).toHaveLength(5);
  });

  it("falls back to the loaded tab for unknown tab parameters", () => {
    renderDetail(createLoaderData({ activeTab: "activity" }), "bogus");

    expect(
      screen.getByText("Anna was added to the project."),
    ).toBeInTheDocument();
  });

  it("persists tab selection in the search parameters", async () => {
    const user = userEvent.setup();
    renderDetail(createLoaderData());
    const setSearchParams = mockedSearchParams.mock.results[0]
      ?.value[1] as ReturnType<typeof vi.fn>;

    await user.click(screen.getByRole("tab", { name: "Team" }));

    expect(setSearchParams).toHaveBeenCalledWith(
      { tab: "team" },
      { preventScrollReset: true },
    );

    await user.click(screen.getByRole("tab", { name: "Allgemein" }));

    expect(setSearchParams).toHaveBeenCalledWith(
      {},
      { preventScrollReset: true },
    );
  });
});

describe("ProjectDetailRoute general tab states", () => {
  it("handles missing values, icons, and empty collections", () => {
    renderDetail(
      createLoaderData({
        events: [],
        goals: [],
        milestones: [],
        project: createProject({
          createdAt: "2026-09-05 11:54",
          description: "",
          hasIcon: true,
          managerName: null,
          notes: "",
          startDate: null,
          targetDate: "not-a-date",
        }),
        tags: [],
        workItems: [],
      }),
    );

    expect(document.querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByText("Nicht zugewiesen")).toBeInTheDocument();
    expect(screen.getByText("not-a-date")).toBeInTheDocument();
    expect(screen.getAllByText("Keine Beschreibung hinterlegt.")).toHaveLength(
      2,
    );
    expect(
      screen.getByText("Noch keine Ziele hinterlegt."),
    ).toBeInTheDocument();
    expect(screen.getByText("Keine anstehenden Termine.")).toBeInTheDocument();
    expect(screen.getByText("Keine Notizen hinterlegt.")).toBeInTheDocument();
    expect(screen.getByText("0 %")).toBeInTheDocument();
  });

  it("opens the edit dialog with empty optional values", async () => {
    const user = userEvent.setup();
    renderDetail(
      createLoaderData({
        project: createProject({ startDate: null, targetDate: null }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Bearbeiten" }));

    const dialog = await screen.findByRole("dialog");

    expect(dialog).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pages")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("combobox", { name: "Projektmanager" }),
    ).toHaveTextContent("Nicht zugewiesen");

    await user.click(within(dialog).getByRole("combobox", { name: "Status" }));
    await user.click(
      await screen.findByRole("option", { name: "Abgeschlossen" }),
    );

    expect(
      within(dialog).getByRole("combobox", { name: "Status" }),
    ).toHaveTextContent("Abgeschlossen");
  });

  it("submits icon uploads when a file is selected", () => {
    renderDetail(
      createLoaderData({ project: createProject({ hasIcon: true }) }),
    );

    const input = screen.getByLabelText<HTMLInputElement>("Icon ändern");
    const requestSubmit = vi.fn();
    Object.defineProperty(input.form, "requestSubmit", {
      value: requestSubmit,
    });

    fireEvent.change(input, {
      target: {
        files: [new File(["image"], "logo.png", { type: "image/png" })],
      },
    });

    expect(requestSubmit).toHaveBeenCalledOnce();
  });

  it("hides editing controls from readers", () => {
    renderDetail(createLoaderData({ canWrite: false }));

    expect(
      screen.queryByRole("button", { name: "Bearbeiten" }),
    ).not.toBeInTheDocument();
  });
});

describe("ProjectDetailRoute team tab states", () => {
  it("submits role changes when a role is selected", async () => {
    const user = userEvent.setup();
    renderDetail(createLoaderData(), "team");

    const roleSelect = screen.getAllByLabelText("Rolle")[0] as HTMLElement;
    const form = roleSelect.closest("form") as HTMLFormElement;
    const requestSubmit = vi.fn();
    Object.defineProperty(form, "requestSubmit", {
      value: requestSubmit,
    });

    await user.click(roleSelect);
    await user.click(await screen.findByRole("option", { name: "Betrachter" }));

    expect(requestSubmit).toHaveBeenCalledOnce();
  });
});

describe("ProjectDetailRoute planning tab states", () => {
  it("handles empty planning collections without write access", () => {
    renderDetail(
      createLoaderData({
        canWrite: false,
        events: [],
        milestones: [],
        workItems: [],
      }),
      "planning",
    );

    expect(screen.getByText("Noch keine Meilensteine.")).toBeInTheDocument();
  });

  it("shows dates without archive actions to readers", async () => {
    const user = userEvent.setup();
    renderDetail(createLoaderData({ canWrite: false }), "planning");

    await user.click(screen.getByRole("tab", { name: "Termine" }));

    expect(screen.getByText("Projektbesprechung")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Projektbesprechung" }),
    ).not.toBeInTheDocument();
  });

  it("shows empty dates and structures on their sections", async () => {
    const user = userEvent.setup();
    renderDetail(
      createLoaderData({ canWrite: false, events: [], workItems: [] }),
      "planning",
    );

    await user.click(screen.getByRole("tab", { name: "Termine" }));
    expect(screen.getByText("Noch keine Termine.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Aufgabenstruktur" }));
    expect(
      screen.getByText("Keine Aufgaben in diesem Projekt."),
    ).toBeInTheDocument();
  });

  it("hides the completion action for completed milestones", () => {
    renderDetail(
      createLoaderData({
        milestones: [
          createMilestone({
            description: "",
            dueAt: null,
            status: "completed",
          }),
        ],
      }),
      "planning",
    );

    expect(screen.queryByRole("button", { name: "✓" })).not.toBeInTheDocument();
  });
});

describe("ProjectDetailRoute integrations tab states", () => {
  it("renders an empty form without an integration", () => {
    renderDetail(createLoaderData({ integration: null }), "integrations");

    expect(
      screen.getByPlaceholderText("https://github.com/user/pages.git"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Integration speichern" }),
    ).toBeInTheDocument();
  });

  it("reveals the token field when replacing a stored key", async () => {
    const user = userEvent.setup();
    renderDetail(
      createLoaderData({
        integration: {
          hasToken: true,
          isConnected: false,
          lastSyncAt: null,
          projectId: "project-1",
          repoName: "user/pages",
          repoUrl: "https://github.com/user/pages.git",
          syncComments: true,
          syncCommits: false,
          syncDirection: "bidirectional",
          syncIssues: true,
          syncPullRequests: false,
          syncStatus: true,
          updatedAt: "2026-09-05",
        },
      }),
      "integrations",
    );

    expect(
      screen.queryByRole("button", { name: "Jetzt synchronisieren" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "API-Key ersetzen" }));

    expect(
      screen.getByPlaceholderText("•••••••••••••••••••"),
    ).toBeInTheDocument();
  });

  it("shows a read-only state without write access", () => {
    renderDetail(
      createLoaderData({ canWrite: false, integration: null }),
      "integrations",
    );

    expect(screen.getByText("Nicht verbunden")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Integration speichern" }),
    ).not.toBeInTheDocument();
  });

  it("shows connected integrations without write access", () => {
    renderDetail(
      createLoaderData({
        canWrite: false,
        integration: {
          hasToken: true,
          isConnected: true,
          lastSyncAt: "2026-09-05 14:21",
          projectId: "project-1",
          repoName: "user/pages",
          repoUrl: "https://github.com/user/pages.git",
          syncComments: true,
          syncCommits: false,
          syncDirection: "bidirectional",
          syncIssues: true,
          syncPullRequests: false,
          syncStatus: true,
          updatedAt: "2026-09-05",
        },
      }),
      "integrations",
    );

    expect(screen.getByText("Verbunden")).toBeInTheDocument();
  });

  it("shows placeholders for missing repository details", () => {
    renderDetail(
      createLoaderData({
        integration: {
          hasToken: false,
          isConnected: false,
          lastSyncAt: null,
          projectId: "project-1",
          repoName: null,
          repoUrl: "",
          syncComments: true,
          syncCommits: false,
          syncDirection: "pull",
          syncIssues: true,
          syncPullRequests: false,
          syncStatus: true,
          updatedAt: "2026-09-05",
        },
      }),
      "integrations",
    );

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Noch nie")).toBeInTheDocument();
  });

  it("indicates pending save and test submissions", () => {
    const saving = new FormData();
    saving.append("intent", "save-integration");
    renderDetail(createLoaderData({ integration: null }), "integrations", {
      formData: saving,
      state: "submitting",
    });
    expect(screen.getByText("Wird gespeichert …")).toBeInTheDocument();

    const testing = new FormData();
    testing.append("intent", "test-integration");
    renderDetail(
      createLoaderData({
        integration: {
          hasToken: true,
          isConnected: false,
          lastSyncAt: null,
          projectId: "project-1",
          repoName: null,
          repoUrl: "https://github.com/user/pages.git",
          syncComments: true,
          syncCommits: false,
          syncDirection: "bidirectional",
          syncIssues: true,
          syncPullRequests: false,
          syncStatus: true,
          updatedAt: "2026-09-05",
        },
      }),
      "integrations",
      { formData: testing, state: "submitting" },
    );
    expect(screen.getByText("Wird getestet …")).toBeInTheDocument();
  });
});

describe("ProjectDetailRoute activity tab states", () => {
  it("shows an empty state without entries", () => {
    renderDetail(
      createLoaderData({ activity: [], taskHistory: [] }),
      "activity",
    );

    expect(
      screen.getByText("Noch keine Aktivitäten in diesem Projekt."),
    ).toBeInTheDocument();
  });

  it("maps every task history action and filters entries", async () => {
    const user = userEvent.setup();
    renderDetail(
      createLoaderData({
        activity: [],
        taskHistory: [
          {
            action: "created",
            createdAt: "2026-09-05 10:00",
            field: null,
            id: "history-created",
            newValue: null,
            oldValue: null,
            userDisplayName: null,
            userId: "user-1",
            workItemId: "item-1",
          },
          {
            action: "archived",
            createdAt: "2026-09-05 11:00",
            field: null,
            id: "history-archived",
            newValue: null,
            oldValue: null,
            userDisplayName: "Alex",
            userId: "user-1",
            workItemId: "item-1",
          },
          {
            action: "parent_changed",
            createdAt: "2026-09-05 12:00",
            field: "parent",
            id: "history-parent",
            newValue: "PAGE-1",
            oldValue: null,
            userDisplayName: "Anna",
            userId: "user-2",
            workItemId: "item-1",
          },
          {
            action: "description_changed",
            createdAt: "2026-09-05 13:00",
            field: null,
            id: "history-other",
            newValue: null,
            oldValue: null,
            userDisplayName: "Anna",
            userId: "user-2",
            workItemId: "item-1",
          },
        ],
      }),
      "activity",
    );

    expect(screen.getByText("hat eine Aufgabe erstellt.")).toBeInTheDocument();
    expect(
      screen.getByText("hat eine Aufgabe archiviert."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("hat eine Aufgabe geändert (parent)."),
    ).toBeInTheDocument();
    expect(screen.getByText("hat eine Aufgabe geändert.")).toBeInTheDocument();

    const selects = screen.getAllByRole("combobox");
    await user.click(selects[0] as HTMLElement);
    await user.click(await screen.findByRole("option", { name: "Team" }));
    expect(
      screen.getByText("Noch keine Aktivitäten in diesem Projekt."),
    ).toBeInTheDocument();

    await user.click(selects[0] as HTMLElement);
    await user.click(
      await screen.findByRole("option", { name: "Alle Aktivitäten" }),
    );
    await user.click(selects[1] as HTMLElement);
    await user.click(await screen.findByRole("option", { name: "Anna" }));
    expect(
      screen.queryByText("hat eine Aufgabe erstellt."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("hat eine Aufgabe geändert (parent)."),
    ).toBeInTheDocument();
  });
});
