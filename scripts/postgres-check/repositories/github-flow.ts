import { call, MISSING_TEXT, prepare, refused } from "./world";

import type { RepositoryFlow } from "./world";

const ISSUE = {
  url: "https://example.test/issue",
  state: "open",
} as const;

const PULL = {
  url: "https://example.test/pull",
  state: "open",
  merged: false,
} as const;

const VISIBLE_DEPARTMENT = {
  departmentIds: ["department-a"],
  projectIds: ["project-git", "project-git-b"],
};

/** GitHub metadata of a project: external issues and pull requests. */
export const GITHUB_FLOW: RepositoryFlow = {
  title: "github metadata",
  steps: [
    call("GitHubRepository.findExternalIssues", ({ github }) =>
      github.findExternalIssues("project-git"),
    ),
    call("GitHubRepository.findExternalIssuesByProjectIds", ({ github }) =>
      github.findExternalIssuesByProjectIds([]),
    ),
    call("GitHubRepository.upsertExternalIssue", ({ github }) =>
      github.upsertExternalIssue({
        ...ISSUE,
        id: "issue-1",
        projectId: "project-git",
        issueNumber: 1,
        title: "Eins",
      }),
    ),
    call("GitHubRepository.upsertExternalIssue", ({ github }) =>
      github.upsertExternalIssue({
        ...ISSUE,
        id: "issue-2",
        projectId: "project-git",
        issueNumber: 2,
        title: "Zwei",
      }),
    ),
    call("GitHubRepository.upsertExternalIssue", ({ github }) =>
      github.upsertExternalIssue({
        ...ISSUE,
        id: "issue-1-again",
        projectId: "project-git",
        issueNumber: 1,
        title: "Eins neu",
        state: "closed",
      }),
    ),
    call("GitHubRepository.upsertExternalIssue", ({ github }) =>
      github.upsertExternalIssue({
        ...ISSUE,
        id: "issue-3",
        projectId: "project-git-b",
        issueNumber: 7,
        title: "Anderes Projekt",
      }),
    ),
    call("GitHubRepository.upsertExternalIssue", ({ github }) =>
      github.upsertExternalIssue({
        ...ISSUE,
        id: "issue-linked",
        projectId: "project-git",
        issueNumber: 3,
        title: "Schon verknüpft",
      }),
    ),
    refused("GitHubRepository.upsertExternalIssue", ({ github }) =>
      github.upsertExternalIssue({
        ...ISSUE,
        id: "issue-x",
        projectId: "project-git",
        issueNumber: 4,
        title: MISSING_TEXT,
      }),
    ),
    prepare(`
      INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by, github_issue_number)
      VALUES
          ('item-git', 'project-git', 'GIT-1', 1, 'task', 'Ticket', 'status-todo', 'user-admin', 3),
          ('item-hidden', 'project-git', 'GIT-2', 2, 'task', 'Verborgen', 'status-todo', 'user-admin', NULL);
      INSERT INTO work_item_departments (work_item_id, department_id)
      VALUES ('item-hidden', 'department-z');
    `),
    call("GitHubRepository.findExternalIssues", ({ github }) =>
      github.findExternalIssues("project-git"),
    ),
    call("GitHubRepository.findExternalIssuesByProjectIds", ({ github }) =>
      github.findExternalIssuesByProjectIds(["project-git", "project-git-b"]),
    ),
    call("GitHubRepository.findExternalIssueById", ({ github }) =>
      github.findExternalIssueById("issue-2"),
    ),
    call("GitHubRepository.findExternalIssueById", ({ github }) =>
      github.findExternalIssueById("nothing"),
    ),
    call("GitHubRepository.findExternalIssueByNumber", ({ github }) =>
      github.findExternalIssueByNumber("project-git", 1),
    ),
    call("GitHubRepository.updateExternalIssue", ({ github }) =>
      github.updateExternalIssue("issue-2", {
        title: "Zwei neu",
        url: "https://example.test/2",
        state: "closed",
      }),
    ),
    call("GitHubRepository.dismissExternalIssue", ({ github }) =>
      github.dismissExternalIssue("issue-2"),
    ),
    call("GitHubRepository.findExternalIssues", ({ github }) =>
      github.findExternalIssues("project-git"),
    ),
    call("GitHubRepository.findExternalIssues", ({ github }) =>
      github.findExternalIssues("project-git", true),
    ),
    call("GitHubRepository.findExternalIssuesByProjectIds", ({ github }) =>
      github.findExternalIssuesByProjectIds(["project-git"], true),
    ),
    call("GitHubRepository.markExternalIssueImported", ({ github }) =>
      github.markExternalIssueImported("issue-1", "item-git"),
    ),
    call("GitHubRepository.findExternalIssueById", ({ github }) =>
      github.findExternalIssueById("issue-1"),
    ),
    call("GitHubRepository.deleteExternalIssue", ({ github }) =>
      github.deleteExternalIssue("issue-3"),
    ),
    call("GitHubRepository.findPullRequestsByProject", ({ github }) =>
      github.findPullRequestsByProject("project-git"),
    ),
    call("GitHubRepository.findPullRequestsByProjectIds", ({ github }) =>
      github.findPullRequestsByProjectIds([]),
    ),
    call("GitHubRepository.upsertPullRequest", ({ github }) =>
      github.upsertPullRequest({
        ...PULL,
        id: "pull-1",
        projectId: "project-git",
        number: 11,
        title: "Ohne Ticket",
        branch: null,
      }),
    ),
    call("GitHubRepository.upsertPullRequest", ({ github }) =>
      github.upsertPullRequest({
        ...PULL,
        id: "pull-2",
        projectId: "project-git",
        number: 12,
        title: "Mit Ticket",
        branch: "feature/ä",
      }),
    ),
    call("GitHubRepository.upsertPullRequest", ({ github }) =>
      github.upsertPullRequest({
        ...PULL,
        id: "pull-3",
        projectId: "project-git",
        number: 13,
        title: "Verborgenes Ticket",
        branch: "x",
      }),
    ),
    call("GitHubRepository.upsertPullRequest", ({ github }) =>
      github.upsertPullRequest({
        ...PULL,
        id: "pull-2-again",
        projectId: "project-git",
        number: 12,
        title: "Mit Ticket neu",
        state: "closed",
        merged: true,
        branch: "feature/ä",
      }),
    ),
    call("GitHubRepository.upsertPullRequest", ({ github }) =>
      github.upsertPullRequest({
        ...PULL,
        id: "pull-4",
        projectId: "project-git-b",
        number: 21,
        title: "Anderes Projekt",
        branch: null,
      }),
    ),
    refused("GitHubRepository.upsertPullRequest", ({ github }) =>
      github.upsertPullRequest({
        ...PULL,
        id: "pull-1",
        projectId: "project-git",
        number: 99,
        title: "Doppelte Kennung",
        branch: null,
      }),
    ),
    call("GitHubRepository.assignPullRequest", ({ github }) =>
      github.assignPullRequest("pull-2", "item-git"),
    ),
    call("GitHubRepository.assignPullRequest", ({ github }) =>
      github.assignPullRequest("pull-3", "item-hidden"),
    ),
    call("GitHubRepository.findPullRequestsByProject", ({ github }) =>
      github.findPullRequestsByProject("project-git"),
    ),
    call("GitHubRepository.findPullRequestsByProject", ({ github }) =>
      github.findPullRequestsByProject("project-git", VISIBLE_DEPARTMENT),
    ),
    call("GitHubRepository.findPullRequestsByProject", ({ github }) =>
      github.findPullRequestsByProject("project-git", {
        departmentIds: [],
        projectIds: [],
      }),
    ),
    call("GitHubRepository.findPullRequestsByProjectIds", ({ github }) =>
      github.findPullRequestsByProjectIds(["project-git", "project-git-b"]),
    ),
    call("GitHubRepository.findPullRequestsByProjectIds", ({ github }) =>
      github.findPullRequestsByProjectIds(
        ["project-git", "project-git-b"],
        VISIBLE_DEPARTMENT,
      ),
    ),
    call("GitHubRepository.findPullRequestsByWorkItem", ({ github }) =>
      github.findPullRequestsByWorkItem("item-git"),
    ),
    call("GitHubRepository.findPullRequestsByWorkItem", ({ github }) =>
      github.findPullRequestsByWorkItem("item-hidden", {
        departmentIds: ["department-a"],
      }),
    ),
    call("GitHubRepository.findPullRequestById", ({ github }) =>
      github.findPullRequestById("pull-2"),
    ),
    call("GitHubRepository.findPullRequestById", ({ github }) =>
      github.findPullRequestById("pull-3", { departmentIds: [] }),
    ),
    call("GitHubRepository.assignPullRequest", ({ github }) =>
      github.assignPullRequest("pull-2", null),
    ),
    call("GitHubRepository.findPullRequestById", ({ github }) =>
      github.findPullRequestById("pull-2"),
    ),
    prepare("DELETE FROM work_item_departments;"),
    prepare("DELETE FROM work_items WHERE project_id = 'project-git';"),
    prepare("DELETE FROM github_pull_requests;"),
    prepare("DELETE FROM github_external_issues;"),
  ],
};
