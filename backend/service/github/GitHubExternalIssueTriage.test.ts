import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import { GitHubExternalIssueTriage } from "./GitHubExternalIssueTriage";
import { gitHubCreationMarker } from "./GitHubCreationIdentity";

import type { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { TaskService } from "@/backend/service/TaskService";
import type { GitHubChangeEvents } from "./GitHubLocalChange";
import type { GitHubSyncAccessGuard } from "./GitHubSyncAccessGuard";
import type { GitHubSyncContextLoader } from "./GitHubSyncContextLoader";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

const ACTOR = { id: "user-1" } as unknown as User;
const VISIBILITY = { departmentIds: null };
const REMOTE: GitHubIssueData = {
  body: `Remote body${gitHubCreationMarker("d".repeat(64))}`,
  number: 8,
  state: "open",
  title: "Remote title",
  updatedAt: "2026-01-02T00:00:00.000Z",
  url: "https://github.com/o/r/issues/8",
};
const EXTERNAL = {
  dismissed: false,
  id: "external-1",
  importedWorkItemId: null,
  issueNumber: 8,
  projectId: "project-1",
};

function task(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeGroupId: null,
    assigneeId: null,
    createdBy: "creator-1",
    description: "Old",
    dueAt: null,
    githubIssueNumber: null,
    id: "task-1",
    isDone: false,
    milestoneId: null,
    parentId: null,
    priority: "normal",
    projectId: "project-1",
    startAt: null,
    statusId: "open",
    title: "Old",
    type: WORK_ITEM_TYPE.TASK,
    ...overrides,
  } as unknown as WorkItemDetail;
}

function announcing(published: PagesEvent[]): GitHubChangeEvents {
  return {
    announce: async <Result>(
      work: () => Promise<Result>,
      decide: (result: Result) => readonly PagesEvent[],
    ): Promise<Result> => {
      const result = await work();
      published.push(...decide(result));
      return result;
    },
  };
}

function setup(linkedNumbers: number[] = []): {
  readonly accessGuard: Record<string, Mock>;
  readonly contextLoader: Record<string, Mock>;
  readonly getIssue: Mock;
  readonly gitHubRepository: Record<string, Mock>;
  readonly published: PagesEvent[];
  readonly taskRepository: Record<string, Mock>;
  readonly taskService: Record<string, Mock>;
  readonly triage: GitHubExternalIssueTriage;
} {
  const getIssue = vi.fn().mockResolvedValue(REMOTE);
  const sync = {
    client: { getIssue },
    repo: { owner: "owner", repo: "repo" },
  };
  const taskRepository = {
    findAllStatuses: vi.fn().mockResolvedValue([
      { id: "other", isDone: false, key: "x", projectId: "project-2" },
      { id: "backlog", isDone: false, key: "backlog", projectId: null },
    ]),
    findById: vi.fn(),
    findKnownGitHubIssueNumbers: vi
      .fn()
      .mockResolvedValue(new Set(linkedNumbers)),
    insertHistory: vi.fn().mockResolvedValue(undefined),
    updateFromGitHub: vi.fn().mockResolvedValue(undefined),
    updateGitHubLink: vi.fn().mockResolvedValue(undefined),
  };
  const gitHubRepository = {
    dismissExternalIssue: vi.fn().mockResolvedValue(undefined),
    findExternalIssueById: vi.fn(),
    findExternalIssueByNumber: vi.fn(),
    markExternalIssueImported: vi.fn().mockResolvedValue(undefined),
  };
  const taskService = {
    create: vi.fn().mockResolvedValue({ id: "created-1" }),
  };
  const accessGuard = {
    requireWritableProject: vi.fn().mockResolvedValue(undefined),
    requireWritableTask: vi.fn(),
    visibility: vi.fn().mockResolvedValue(VISIBILITY),
  };
  const contextLoader = { requireContext: vi.fn().mockResolvedValue(sync) };
  const published: PagesEvent[] = [];
  const events = announcing(published);
  const triage = new GitHubExternalIssueTriage({
    accessGuard: accessGuard as unknown as GitHubSyncAccessGuard,
    contextLoader: contextLoader as unknown as GitHubSyncContextLoader,
    events,
    gitHubRepository: gitHubRepository as unknown as GitHubRepository,
    now: () => "2026-03-01T00:00:00.000Z",
    taskRepository: taskRepository as unknown as TaskRepository,
    taskService: taskService as unknown as TaskService,
  });

  return {
    accessGuard,
    contextLoader,
    getIssue,
    gitHubRepository,
    published,
    taskRepository,
    taskService,
    triage,
  };
}

describe("importIssue", () => {
  it.each([
    ["unknown", null, []],
    ["dismissed", { ...EXTERNAL, dismissed: true }, []],
    ["imported", { ...EXTERNAL, importedWorkItemId: "t" }, []],
    ["linked to a task", EXTERNAL, [8]],
  ])("rejects an issue that is %s", async (_, external, linked) => {
    const fixture = setup(linked);
    fixture.gitHubRepository.findExternalIssueByNumber.mockResolvedValue(
      external,
    );

    const rejection = fixture.triage.importIssue(ACTOR, "project-1", 8);

    await expect(rejection).rejects.toBeInstanceOf(WorkItemValidationError);
    await expect(rejection).rejects.toMatchObject({
      code: "githubIssueNotImportable",
    });
    expect(fixture.accessGuard.requireWritableProject).toHaveBeenCalledWith(
      ACTOR,
      "project-1",
    );
  });

  it("fails without any workflow status", async () => {
    const fixture = setup();
    fixture.gitHubRepository.findExternalIssueByNumber.mockResolvedValue(
      EXTERNAL,
    );
    fixture.taskRepository.findAllStatuses.mockResolvedValue([]);

    await expect(
      fixture.triage.importIssue(ACTOR, "project-1", 8),
    ).rejects.toThrow("No workflow status is available for imported tasks.");
  });

  it("falls back to the first status when no status is open", async () => {
    const fixture = setup();
    fixture.gitHubRepository.findExternalIssueByNumber.mockResolvedValue(
      EXTERNAL,
    );
    fixture.taskRepository.findAllStatuses.mockResolvedValue([
      { id: "done", isDone: true, key: "done", projectId: null },
    ]);
    fixture.taskRepository.findById.mockResolvedValue(task());

    await fixture.triage.importIssue(ACTOR, "project-1", 8);

    expect(fixture.taskService.create).toHaveBeenCalledWith(
      ACTOR,
      expect.objectContaining({ statusId: "done" }),
    );
  });
});

describe("importIssue success", () => {
  it("creates, links, marks, and records the issue as one change", async () => {
    const fixture = setup();
    const linked = task({ id: "created-1" });
    fixture.gitHubRepository.findExternalIssueByNumber.mockResolvedValue(
      EXTERNAL,
    );
    fixture.taskRepository.findById.mockResolvedValue(linked);

    await expect(
      fixture.triage.importIssue(ACTOR, "project-1", 8),
    ).resolves.toBe(linked);

    expect(fixture.getIssue).toHaveBeenCalledWith("owner", "repo", 8);
    expect(fixture.taskService.create).toHaveBeenCalledWith(ACTOR, {
      description: "Remote body",
      dueAt: null,
      milestoneId: null,
      parentId: null,
      priority: "normal",
      projectId: "project-1",
      skipGitHubSync: true,
      statusId: "backlog",
      title: "Remote title",
      type: WORK_ITEM_TYPE.TASK,
    });
    expect(fixture.taskRepository.updateGitHubLink).toHaveBeenCalledWith(
      "created-1",
      expect.objectContaining({
        issueNumber: 8,
        lastSyncAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    expect(
      fixture.gitHubRepository.markExternalIssueImported,
    ).toHaveBeenCalledWith("external-1", "created-1");
    expect(fixture.taskRepository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ newValue: "#8", workItemId: "created-1" }),
    );
    expect(fixture.published).toEqual([
      { type: "ticket.changed", id: "created-1" },
    ]);
    expect(fixture.taskRepository.findById).toHaveBeenCalledWith(
      "created-1",
      VISIBILITY,
    );
  });

  it("fails when the imported task cannot be read back", async () => {
    const fixture = setup();
    fixture.gitHubRepository.findExternalIssueByNumber.mockResolvedValue(
      EXTERNAL,
    );
    fixture.taskRepository.findById.mockResolvedValue(null);

    await expect(
      fixture.triage.importIssue(ACTOR, "project-1", 8),
    ).rejects.toThrow("Imported task could not be retrieved.");
  });
});

describe("linkIssue", () => {
  function prepare(
    item: WorkItemDetail,
    external: unknown = EXTERNAL,
    linked: number[] = [],
  ): ReturnType<typeof setup> {
    const fixture = setup(linked);
    fixture.accessGuard.requireWritableTask.mockResolvedValue(item);
    fixture.gitHubRepository.findExternalIssueById.mockResolvedValue(external);

    return fixture;
  }

  it("rejects items that are not tasks", async () => {
    const fixture = prepare(task({ type: WORK_ITEM_TYPE.EPIC }));

    await expect(
      fixture.triage.linkIssue(ACTOR, "task-1", "external-1"),
    ).rejects.toMatchObject({ code: "githubOnlyTasksLinkable" });
  });

  it("rejects tasks that are already linked", async () => {
    const fixture = prepare(task({ githubIssueNumber: 3 }));

    await expect(
      fixture.triage.linkIssue(ACTOR, "task-1", "external-1"),
    ).rejects.toMatchObject({ code: "githubTaskAlreadyLinked" });
  });

  it.each([
    ["unknown", null, []],
    ["of another project", { ...EXTERNAL, projectId: "project-2" }, []],
    ["dismissed", { ...EXTERNAL, dismissed: true }, []],
    ["imported", { ...EXTERNAL, importedWorkItemId: "t" }, []],
    ["linked to a task", EXTERNAL, [8]],
  ])("rejects an issue that is %s", async (_, external, linked) => {
    const fixture = prepare(task(), external, linked);

    await expect(
      fixture.triage.linkIssue(ACTOR, "task-1", "external-1"),
    ).rejects.toMatchObject({ code: "githubIssueNotLinkable" });
  });

  it("adopts the issue values and links both sides", async () => {
    const fixture = prepare(task());
    const linked = task({ githubIssueNumber: 8 });
    fixture.taskRepository.findById.mockResolvedValue(linked);

    await expect(
      fixture.triage.linkIssue(ACTOR, "task-1", "external-1"),
    ).resolves.toBe(linked);

    expect(fixture.taskRepository.updateFromGitHub).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        description: "Remote body",
        statusId: "open",
        title: "Remote title",
      }),
    );
    expect(
      fixture.gitHubRepository.markExternalIssueImported,
    ).toHaveBeenCalledWith("external-1", "task-1");
    expect(fixture.taskRepository.insertHistory).toHaveBeenCalled();
    expect(fixture.published).toEqual([
      { type: "ticket.changed", id: "task-1" },
    ]);
  });

  it("fails when the linked task cannot be read back", async () => {
    const fixture = prepare(task());
    fixture.taskRepository.findById.mockResolvedValue(null);

    await expect(
      fixture.triage.linkIssue(ACTOR, "task-1", "external-1"),
    ).rejects.toThrow("Linked task could not be retrieved.");
  });
});

describe("dismissIssue", () => {
  it("rejects an unknown issue", async () => {
    const fixture = setup();
    fixture.gitHubRepository.findExternalIssueById.mockResolvedValue(null);

    await expect(
      fixture.triage.dismissIssue(ACTOR, "external-1"),
    ).rejects.toMatchObject({ code: "githubIssueNotDismissable" });
    expect(
      fixture.gitHubRepository.dismissExternalIssue,
    ).not.toHaveBeenCalled();
  });

  it("dismisses the issue after checking write access", async () => {
    const fixture = setup();
    fixture.gitHubRepository.findExternalIssueById.mockResolvedValue(EXTERNAL);

    await fixture.triage.dismissIssue(ACTOR, "external-1");

    expect(fixture.accessGuard.requireWritableProject).toHaveBeenCalledWith(
      ACTOR,
      "project-1",
    );
    expect(fixture.gitHubRepository.dismissExternalIssue).toHaveBeenCalledWith(
      "external-1",
    );
  });
});
