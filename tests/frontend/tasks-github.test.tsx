// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TasksGitHub } from "@/app/components/tasks/tasks-github";
import { createI18n } from "@/app/lib/i18n";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { TasksGitHubProjectState } from "@/app/components/tasks/tasks-github";
import type { WorkItemDetail } from "@/definition/Task";

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
    key: "PAGE-42",
    milestoneId: null,
    milestoneName: null,
    number: 42,
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
    title: "GitHub Synchronisation implementieren",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function createProject() {
  return {
    createdAt: "2026-01-01",
    description: "",
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
    status: "active" as const,
    targetDate: null,
    updatedAt: "2026-01-02",
  };
}

function createIntegration() {
  return {
    hasToken: true,
    isConnected: true,
    lastSyncAt: "2026-09-05 14:21",
    nextSyncAt: "2026-09-05 14:36",
    projectId: "project-1",
    repoName: "user/pages",
    repoUrl: "https://github.com/user/pages.git",
    syncComments: true,
    syncCommits: false,
    syncDirection: "bidirectional" as const,
    syncIntervalMinutes: 15 as const,
    syncIssues: true,
    syncPullRequests: true,
    syncStatus: true,
    updatedAt: "2026-09-05",
  };
}

function renderGitHub(
  states: readonly TasksGitHubProjectState[],
  workItems: readonly WorkItemDetail[] = [createWorkItem()],
  onAction: (fields: Record<string, string>) => void = () => {},
): {
  onSelectTask: ReturnType<typeof vi.fn>;
  onOpenTask: ReturnType<typeof vi.fn>;
} {
  const onSelectTask = vi.fn();
  const onOpenTask = vi.fn();
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
          <TasksGitHub
            onOpenTask={onOpenTask}
            onSelectTask={onSelectTask}
            states={states}
            workItems={workItems}
          />
        ),
        path: "/",
      },
    ],
    {
      initialEntries: ["/"],
    },
  );

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );

  return { onOpenTask, onSelectTask };
}

describe("TasksGitHub", () => {
  it("renders sync state with triage and pull request actions", async () => {
    const user = userEvent.setup();
    const submitted: Record<string, string>[] = [];
    renderGitHub(
      [
        {
          externalIssues: [
            {
              detectedAt: "2026-09-05 14:21",
              dismissed: false,
              id: "external-104",
              importedWorkItemId: null,
              issueNumber: 104,
              projectId: "project-1",
              state: "open",
              title: "Mobile Navigation funktioniert nicht",
              updatedAt: "2026-09-05 14:21",
              url: "https://github.com/user/pages/issues/104",
            },
          ],
          integration: createIntegration(),
          project: createProject(),
          pullRequests: [
            {
              branch: "feature/github-sync",
              id: "pr-1",
              merged: false,
              number: 91,
              projectId: "project-1",
              state: "open",
              syncedAt: "2026-09-05 14:21",
              title: "GitHub Sync",
              url: "https://github.com/user/pages/pull/91",
              workItemId: null,
              workItemKey: null,
            },
          ],
        },
      ],
      [createWorkItem()],
      (fields) => submitted.push(fields),
    );

    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByText("#104")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Als Task importieren" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ignorieren" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Nicht zugeordnet")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("Task auswählen …"),
      "item-1",
    );
    await user.click(
      screen.getByRole("button", { name: "Als Task importieren" }),
    );

    expect(submitted).toContainEqual(
      expect.objectContaining({
        intent: "github-import-issue",
        issueNumber: "104",
        projectId: "project-1",
      }),
    );
  });

  it("indicates pending synchronization runs", () => {
    renderGitHub(
      [
        {
          externalIssues: [],
          integration: createIntegration(),
          project: createProject(),
          pullRequests: [],
        },
      ],
      [createWorkItem()],
    );

    expect(screen.getByText(/user\/pages/)).toBeInTheDocument();
  });

  it("shows syncing progress on connected projects", () => {
    const i18n = createI18n(LANGUAGE.GERMAN);
    const router = createMemoryRouter(
      [
        {
          element: (
            <TasksGitHub
              isSyncing={true}
              onOpenTask={vi.fn()}
              onSelectTask={vi.fn()}
              states={[
                {
                  externalIssues: [],
                  integration: { ...createIntegration(), repoName: null },
                  project: createProject(),
                  pullRequests: [],
                },
              ]}
              workItems={[createWorkItem()]}
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

    expect(screen.getByText("Wird getestet …")).toBeInTheDocument();
  });

  it("navigates to assigned tasks from pull requests", async () => {
    const user = userEvent.setup();
    const { onOpenTask, onSelectTask } = renderGitHub([
      {
        externalIssues: [],
        integration: createIntegration(),
        project: createProject(),
        pullRequests: [
          {
            branch: "feature/github-sync",
            id: "pr-1",
            merged: false,
            number: 91,
            projectId: "project-1",
            state: "open",
            syncedAt: "2026-09-05 14:21",
            title: "GitHub Sync",
            url: "https://github.com/user/pages/pull/91",
            workItemId: "item-1",
            workItemKey: "PAGE-42",
          },
        ],
      },
    ]);

    await user.click(screen.getByRole("button", { name: "PAGE-42" }));

    expect(onSelectTask).toHaveBeenCalledWith("PAGE-42");

    await user.dblClick(screen.getByRole("button", { name: "PAGE-42" }));

    expect(onOpenTask).toHaveBeenCalledWith("PAGE-42");
  });

  it("hides assignment controls without linkable tasks", () => {
    renderGitHub(
      [
        {
          externalIssues: [],
          integration: createIntegration(),
          project: createProject(),
          pullRequests: [
            {
              branch: null,
              id: "pr-2",
              merged: true,
              number: 90,
              projectId: "project-1",
              state: "closed",
              syncedAt: "2026-09-05 14:21",
              title: "Old work",
              url: "https://github.com/user/pages/pull/90",
              workItemId: null,
              workItemKey: null,
            },
          ],
        },
      ],
      [],
    );

    expect(screen.queryByLabelText("Task zuweisen …")).not.toBeInTheDocument();
  });

  it("submits pull request assignments on selection", () => {
    renderGitHub([
      {
        externalIssues: [],
        integration: createIntegration(),
        project: createProject(),
        pullRequests: [
          {
            branch: "feature/github-sync",
            id: "pr-1",
            merged: false,
            number: 91,
            projectId: "project-1",
            state: "open",
            syncedAt: "2026-09-05 14:21",
            title: "GitHub Sync",
            url: "https://github.com/user/pages/pull/91",
            workItemId: null,
            workItemKey: null,
          },
        ],
      },
    ]);

    const select = screen.getByLabelText(
      "Task zuweisen …",
    ) as HTMLSelectElement;
    const requestSubmit = vi.fn();
    Object.defineProperty(select.form, "requestSubmit", {
      value: requestSubmit,
    });

    fireEvent.change(select, { target: { value: "item-1" } });

    expect(requestSubmit).toHaveBeenCalledOnce();
  });

  it("renders disconnected projects without sync actions", () => {
    renderGitHub(
      [
        {
          externalIssues: [
            {
              detectedAt: "2026-09-05 14:21",
              dismissed: false,
              id: "external-104",
              importedWorkItemId: null,
              issueNumber: 104,
              projectId: "project-1",
              state: "open",
              title: "Mobile Navigation funktioniert nicht",
              updatedAt: "2026-09-05 14:21",
              url: "https://github.com/user/pages/issues/104",
            },
          ],
          integration: {
            ...createIntegration(),
            isConnected: false,
          },
          project: createProject(),
          pullRequests: [],
        },
      ],
      [],
    );

    expect(screen.getByText("Nicht verbunden")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Jetzt synchronisieren" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("#104")).toBeInTheDocument();
    expect(screen.queryByLabelText("Task auswählen …")).not.toBeInTheDocument();
    expect(
      screen.getByText("Keine Pull Requests erkannt."),
    ).toBeInTheDocument();
  });

  it("renders an empty state without projects", () => {
    renderGitHub([]);

    expect(screen.getByText("Keine Projekte verfügbar.")).toBeInTheDocument();
  });
});
