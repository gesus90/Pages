import { beforeEach, expect, it, vi } from "vitest";

import { GitHubExternalIssueTriage } from "@/backend/service/github/GitHubExternalIssueTriage";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { GitHubExternalIssueTriageOptions } from "@/backend/service/github/GitHubExternalIssueTriage";
import type { User } from "@/definition/User";

const findExternalIssueByNumber = vi.fn();
const findExternalIssueById = vi.fn();
const markExternalIssueImported = vi.fn();
const dismissExternalIssue = vi.fn();
const findKnownGitHubIssueNumbers = vi.fn();
const findAllStatuses = vi.fn();
const updateGitHubLink = vi.fn();
const insertHistory = vi.fn();
const findById = vi.fn();
const create = vi.fn();
const requireWritableProject = vi.fn();
const requireWritableTask = vi.fn();
const visibility = vi.fn();
const getIssue = vi.fn();
const actor = partial<User>({ id: "user" });
const external = {
  id: "external",
  projectId: "project",
  issueNumber: 42,
  dismissed: false,
  importedWorkItemId: null,
};
const remote = {
  number: 42,
  title: "Remote",
  body: "Description",
  state: "open",
  updatedAt: "now",
  url: "https://example.com/42",
};
const item = {
  id: "ticket",
  type: "task",
  projectId: "project",
  githubIssueNumber: null,
  statusId: "open",
};
const triage = new GitHubExternalIssueTriage(
  partial<GitHubExternalIssueTriageOptions>({
    taskRepository: {
      findKnownGitHubIssueNumbers,
      findAllStatuses,
      updateGitHubLink,
      insertHistory,
      findById,
    },
    gitHubRepository: {
      findExternalIssueByNumber,
      findExternalIssueById,
      markExternalIssueImported,
      dismissExternalIssue,
    },
    taskService: { create },
    accessGuard: { requireWritableProject, requireWritableTask, visibility },
    contextLoader: {
      requireContext: async () => ({
        client: { getIssue },
        repo: { owner: "owner", repo: "repo" },
      }),
    },
    events: { announce: async (work: () => Promise<unknown>) => work() },
    now: () => "now",
  }),
);

beforeEach(() => {
  vi.resetAllMocks();
  findExternalIssueByNumber.mockResolvedValue(external);
  findExternalIssueById.mockResolvedValue(external);
  findKnownGitHubIssueNumbers.mockResolvedValue(new Set());
  findAllStatuses.mockResolvedValue([
    { id: "open", key: "backlog", projectId: null, isDone: false },
  ]);
  create.mockResolvedValue(item);
  findById.mockResolvedValue(item);
  requireWritableTask.mockResolvedValue(item);
  getIssue.mockResolvedValue(remote);
});

it("imports a visible remote issue and records its link and history", async () => {
  expect(await triage.importIssue(actor, "project", 42)).toEqual(item);
  expect(create).toHaveBeenCalledWith(
    actor,
    expect.objectContaining({
      projectId: "project",
      title: "Remote",
      description: "Description",
      statusId: "open",
      skipGitHubSync: true,
    }),
  );
  expect(updateGitHubLink).toHaveBeenCalledWith(
    "ticket",
    expect.objectContaining({ issueNumber: 42 }),
  );
  expect(markExternalIssueImported).toHaveBeenCalledWith("external", "ticket");
  expect(insertHistory).toHaveBeenCalledOnce();
});

it("does not import dismissed, linked or already known issues", async () => {
  findExternalIssueByNumber
    .mockResolvedValueOnce({ ...external, dismissed: true })
    .mockResolvedValueOnce({ ...external, importedWorkItemId: "ticket" })
    .mockResolvedValueOnce(external);
  await expect(triage.importIssue(actor, "project", 42)).rejects.toThrow();
  await expect(triage.importIssue(actor, "project", 42)).rejects.toThrow();
  findKnownGitHubIssueNumbers.mockResolvedValueOnce(new Set([42]));
  await expect(triage.importIssue(actor, "project", 42)).rejects.toThrow();
  expect(getIssue).not.toHaveBeenCalled();
});

it("checks ticket and project eligibility before linking", async () => {
  requireWritableTask
    .mockResolvedValueOnce({ ...item, type: "epic" })
    .mockResolvedValueOnce({ ...item, githubIssueNumber: 7 })
    .mockResolvedValueOnce(item);
  await expect(triage.linkIssue(actor, "ticket", "external")).rejects.toThrow();
  await expect(triage.linkIssue(actor, "ticket", "external")).rejects.toThrow();
  findExternalIssueById.mockResolvedValueOnce({
    ...external,
    projectId: "other",
  });
  await expect(triage.linkIssue(actor, "ticket", "external")).rejects.toThrow();
  expect(getIssue).not.toHaveBeenCalled();
});

it("requires project write access before dismissing an issue", async () => {
  await triage.dismissIssue(actor, "external");
  expect(requireWritableProject).toHaveBeenCalledWith(actor, "project");
  expect(dismissExternalIssue).toHaveBeenCalledWith("external");
  findExternalIssueById.mockResolvedValueOnce(null);
  await expect(triage.dismissIssue(actor, "missing")).rejects.toThrow();
});
