import { beforeEach, expect, it, vi } from "vitest";

import {
  handleAssignPullRequest,
  handleDismissGitHubIssue,
  handleImportGitHubIssue,
  handleLinkGitHubIssue,
  handleResolveGitHubConflict,
  handleSyncGitHubProject,
  handleSyncGitHubTask,
} from "@/app/lib/task-actions/task-github-actions.server";

import { ACTOR } from "../../actions/action-fixtures";
import { runTaskHandler } from "./task-action-fixtures";

import type { TaskActionHandler } from "@/app/lib/task-actions/task-action-support.server";
import type { FormFields } from "../../actions/action-fixtures";

const gitHubSyncService = {
  assignPullRequest: vi.fn(),
  dismissExternalIssue: vi.fn(),
  importExternalIssue: vi.fn(),
  linkExternalIssue: vi.fn(),
  resolveConflict: vi.fn(),
  syncProjectNow: vi.fn(),
  syncSingleTask: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  gitHubSyncService.importExternalIssue.mockResolvedValue({ key: "SYN-9" });
  gitHubSyncService.linkExternalIssue.mockResolvedValue({ key: "SYN-8" });
  gitHubSyncService.resolveConflict.mockResolvedValue({ key: "SYN-7" });
});

async function run(
  handler: TaskActionHandler,
  fields: FormFields,
): ReturnType<typeof runTaskHandler> {
  return runTaskHandler(handler, { gitHubSyncService }, fields);
}

interface GitHubCase {
  readonly handler: TaskActionHandler;
  readonly fields: FormFields;
  readonly method: keyof typeof gitHubSyncService;
  readonly call: readonly unknown[];
  readonly body: object;
}

const SUCCESSES: readonly (readonly [string, GitHubCase])[] = [
  [
    "synchronizes a project",
    {
      handler: handleSyncGitHubProject,
      fields: { projectId: "p1" },
      method: "syncProjectNow",
      call: [ACTOR, "p1"],
      body: { ok: true, intent: "sync-github-project" },
    },
  ],
  [
    "synchronizes a ticket",
    {
      handler: handleSyncGitHubTask,
      fields: { id: "t1" },
      method: "syncSingleTask",
      call: [ACTOR, "t1"],
      body: { ok: true, intent: "sync-github-task" },
    },
  ],
  [
    "imports an issue",
    {
      handler: handleImportGitHubIssue,
      fields: { projectId: "p1", issueNumber: "42" },
      method: "importExternalIssue",
      call: [ACTOR, "p1", 42],
      body: { ok: true, intent: "github-import-issue", key: "SYN-9" },
    },
  ],
  [
    "links an issue",
    {
      handler: handleLinkGitHubIssue,
      fields: { workItemId: "t1", externalId: "e1" },
      method: "linkExternalIssue",
      call: [ACTOR, "t1", "e1"],
      body: { ok: true, intent: "github-link-issue", key: "SYN-8" },
    },
  ],
  [
    "dismisses an issue",
    {
      handler: handleDismissGitHubIssue,
      fields: { externalId: "e1" },
      method: "dismissExternalIssue",
      call: [ACTOR, "e1"],
      body: { ok: true, intent: "github-dismiss-issue" },
    },
  ],
  [
    "attaches a pull request",
    {
      handler: handleAssignPullRequest,
      fields: { pullRequestId: "pr1", workItemId: "t1" },
      method: "assignPullRequest",
      call: [ACTOR, "pr1", "t1"],
      body: { ok: true, intent: "github-assign-pr" },
    },
  ],
  [
    "detaches a pull request",
    {
      handler: handleAssignPullRequest,
      fields: { pullRequestId: "pr1", workItemId: "" },
      method: "assignPullRequest",
      call: [ACTOR, "pr1", null],
      body: { ok: true, intent: "github-assign-pr" },
    },
  ],
  [
    "keeps the Pages side of a conflict",
    {
      handler: handleResolveGitHubConflict,
      fields: { id: "t1", resolution: "pages" },
      method: "resolveConflict",
      call: [ACTOR, "t1", "pages"],
      body: { ok: true, intent: "github-resolve-conflict", key: "SYN-7" },
    },
  ],
  [
    "keeps the GitHub side of a conflict",
    {
      handler: handleResolveGitHubConflict,
      fields: { id: "t1", resolution: "github" },
      method: "resolveConflict",
      call: [ACTOR, "t1", "github"],
      body: { ok: true, intent: "github-resolve-conflict", key: "SYN-7" },
    },
  ],
];

it.each(SUCCESSES)("%s", async (caseName, github) => {
  const outcome = await run(github.handler, github.fields);

  expect(gitHubSyncService[github.method]).toHaveBeenCalledExactlyOnceWith(
    ...github.call,
  );
  expect(outcome).toMatchObject({ status: 200, body: github.body });
});

const REFUSALS: readonly (readonly [string, TaskActionHandler, FormFields])[] =
  [
    ["a project sync without project", handleSyncGitHubProject, {}],
    ["a ticket sync without ticket", handleSyncGitHubTask, {}],
    [
      "an import without project",
      handleImportGitHubIssue,
      { issueNumber: "1" },
    ],
    ["an import without number", handleImportGitHubIssue, { projectId: "p1" }],
    [
      "an import of a fraction",
      handleImportGitHubIssue,
      { projectId: "p1", issueNumber: "1.5" },
    ],
    [
      "an import of issue zero",
      handleImportGitHubIssue,
      { projectId: "p1", issueNumber: "0" },
    ],
    ["a link without ticket", handleLinkGitHubIssue, { externalId: "e1" }],
    ["a link without issue", handleLinkGitHubIssue, { workItemId: "t1" }],
    ["a dismissal without issue", handleDismissGitHubIssue, {}],
    [
      "an assignment without pull request",
      handleAssignPullRequest,
      { workItemId: "t1" },
    ],
    [
      "a resolution without ticket",
      handleResolveGitHubConflict,
      { resolution: "pages" },
    ],
    [
      "an unknown resolution",
      handleResolveGitHubConflict,
      { id: "t1", resolution: "both" },
    ],
  ];

it.each(REFUSALS)("refuses %s", async (caseName, handler, fields) => {
  const outcome = await run(handler, fields);

  expect(outcome).toMatchObject({
    status: 400,
    body: { ok: false, error: "invalidInput" },
  });
  for (const method of Object.values(gitHubSyncService)) {
    expect(method).not.toHaveBeenCalled();
  }
});
