// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";

import { TaskGitHubDetails } from "@/app/components/tasks/task-github-details";
import { createI18n } from "@/app/lib/i18n";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";
import { LANGUAGE } from "@/language/Language";

import type { GitHubPullRequest } from "@/definition/GitHub";
import type { WorkItemDetail } from "@/definition/Task";

function createTask(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
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
    githubIssueNumber: 42,
    githubIssueState: "closed",
    githubIssueUpdatedAt: "2026-09-05T14:00:00.000Z",
    githubIssueUrl: "https://github.com/user/pages/issues/42",
    githubLastError: null,
    githubLastSyncAt: "2026-09-05T15:00:00.000Z",
    id: "item-1",
    isDone: false,
    key: "PAGE-14",
    milestoneId: null,
    milestoneName: null,
    number: 14,
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
    title: "Login Seite erstellen",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-09-05T14:00:00.000Z",
    ...overrides,
  };
}

function createPullRequest(
  overrides: Partial<GitHubPullRequest> = {},
): GitHubPullRequest {
  return {
    branch: "feature/login",
    id: "pr-1",
    merged: false,
    number: 48,
    projectId: "project-1",
    state: "open",
    syncedAt: "2026-09-05",
    title: "Login UI",
    url: "https://github.com/user/pages/pull/48",
    workItemId: "item-1",
    workItemKey: "PAGE-14",
    ...overrides,
  };
}

function renderDetails(
  properties: Partial<Parameters<typeof TaskGitHubDetails>[0]> = {},
): void {
  const i18n = createI18n(LANGUAGE.GERMAN);
  const router = createMemoryRouter(
    [
      {
        async action() {
          return null;
        },
        element: (
          <TaskGitHubDetails
            pullRequests={[]}
            task={createTask()}
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

describe("TaskGitHubDetails", () => {
  it("renders linked issues with pull requests", () => {
    renderDetails({
      pullRequests: [
        createPullRequest(),
        createPullRequest({
          id: "pr-2",
          merged: false,
          number: 52,
          state: "closed",
          title: "Login validation",
        }),
        createPullRequest({
          id: "pr-3",
          merged: true,
          number: 53,
          state: "closed",
          title: "Login styles",
        }),
      ],
    });

    expect(screen.getByText("Synchronisiert")).toBeInTheDocument();
    expect(screen.getByText(/Issue #42/)).toBeInTheDocument();
    expect(screen.getByText("Offen")).toBeInTheDocument();
    expect(screen.getByText("#48 Login UI")).toBeInTheDocument();
    expect(screen.getAllByText("Geschlossen")).toHaveLength(2);
    expect(screen.getByText("Gemergt")).toBeInTheDocument();
    expect(screen.getByText(/Letzte Synchronisation/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Jetzt synchronisieren" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Auf GitHub öffnen/ }),
    ).toBeInTheDocument();
  });

  it("renders unlinked tickets with a hint", () => {
    renderDetails({
      task: createTask({
        githubIssueNumber: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
      }),
    });

    expect(screen.getByText("Nicht verknüpft")).toBeInTheDocument();
    expect(
      screen.getByText(/Noch kein GitHub Issue verknüpft/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Jetzt synchronisieren" }),
    ).not.toBeInTheDocument();
  });

  it("renders sync errors with a retry action", () => {
    renderDetails({
      task: createTask({
        githubIssueState: "open",
        githubLastError: "Forbidden",
      }),
    });

    expect(
      screen.getByText("Synchronisierung fehlgeschlagen."),
    ).toBeInTheDocument();
    expect(screen.getByText("Forbidden")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Erneut versuchen" }),
    ).toBeInTheDocument();
  });

  it("renders conflict resolution actions", () => {
    renderDetails({
      task: createTask({ githubConflict: true }),
    });

    expect(
      screen.getByRole("button", { name: "Pages behalten" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "GitHub übernehmen" }),
    ).toBeInTheDocument();
  });

  it("disables sync actions while syncing", () => {
    renderDetails({ isSyncing: true });

    expect(
      screen.getByRole("button", { name: "Jetzt synchronisieren" }),
    ).toBeDisabled();
  });
});
