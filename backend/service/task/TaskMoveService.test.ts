import { expect, it, vi } from "vitest";

import { TaskMoveService } from "./TaskMoveService";

import { taskUpdateSnapshot } from "@/definition/TaskUpdateSnapshot";
import { ROLE } from "@/definition/Role";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "./TaskAccessGuard";
import type { TaskHistoryRecorder } from "./TaskHistoryRecorder";
import type { WorkItemNumbering } from "./WorkItemNumbering";
import type { WorkItemReferenceValidator } from "./WorkItemReferenceValidator";
import type { WorkItemDetail } from "@/definition/Task";
import type { TaskMoveSnapshot } from "@/definition/TaskUpdateSnapshot";
import type { User } from "@/definition/User";

const actor: User = {
  displayName: "U",
  id: "u",
  isActive: true,
  mustChangePassword: false,
  role: ROLE.EMPLOYEE,
  username: "u",
};

type Mock = ReturnType<typeof vi.fn>;

function doubleOf<Type extends object>(members: object): Type {
  return members as Type;
}

function ticket(id: string, patch: object = {}): object {
  return {
    assigneeId: null,
    description: "",
    githubIssueNumber: null,
    id,
    milestoneId: null,
    parentId: null,
    projectId: "src",
    title: id,
    ...patch,
  };
}

interface Facts {
  readonly children?: Record<string, readonly object[]>;
  readonly root?: object | null;
  readonly sameProject?: boolean;
  readonly moved?: object | null;
  readonly eligible?: boolean;
  readonly milestone?: object | null;
  readonly conditionalMoved?: boolean;
}

function setup(facts: Facts = {}): {
  readonly service: TaskMoveService;
  readonly repository: Record<string, Mock>;
  readonly history: Record<string, Mock>;
  readonly cache: Record<string, Mock>;
} {
  const repository: Record<string, Mock> = {
    findById: vi.fn(async (id: string) => {
      if (id === "t")
        return facts.root === undefined ? ticket("t") : facts.root;
      return facts.moved === undefined ? ticket(id) : facts.moved;
    }),
    findMilestoneById: vi.fn(async () =>
      facts.milestone === undefined ? { projectId: "dst" } : facts.milestone,
    ),
    findSubtasks: vi.fn(async (id: string) => facts.children?.[id] ?? []),
    moveSubtreeIfCurrent: vi.fn(async () => facts.conditionalMoved ?? true),
    moveToProject: vi.fn(async () => {}),
  };
  const history: Record<string, Mock> = {
    recordProjectMove: vi.fn(async () => {}),
  };
  const cache: Record<string, Mock> = {
    invalidateLabels: vi.fn(),
    invalidateWorkItems: vi.fn(),
  };
  const access = doubleOf<TaskAccessGuard>({
    requireWorkItem: vi.fn(async () =>
      ticket("t", { projectId: facts.sameProject ? "dst" : "src" }),
    ),
    requireWritableProject: vi.fn(async () => ({ id: "dst", name: "Dest" })),
    visibility: vi.fn(async () => ({ departmentIds: null })),
  });
  const numbering = doubleOf<WorkItemNumbering>({
    run: vi.fn(
      async (
        ignoredProject: unknown,
        ignoredCount: number,
        work: (sequence: object) => Promise<void>,
      ) => work({ firstNumber: 10, projectKey: "DST" }),
    ),
  });
  const validator = doubleOf<WorkItemReferenceValidator>({
    isEligibleAssignee: vi.fn(async () => facts.eligible ?? true),
  });

  return {
    cache,
    history,
    repository,
    service: new TaskMoveService({
      access,
      cache: doubleOf<ServerCache>(cache),
      history: doubleOf<TaskHistoryRecorder>(history),
      numbering,
      taskRepository: doubleOf<TaskRepository>(repository),
      validator,
    }),
  };
}

function snapshot(parentId: string | null): TaskMoveSnapshot {
  return {
    fields: {
      ...taskUpdateSnapshot(doubleOf<WorkItemDetail>(ticket("t"))),
      parentId,
    },
    githubIssueNumber: null,
    projectId: "src",
  };
}

it("moves a subtree and renumbers every item", async () => {
  const { cache, history, repository, service } = setup({
    children: { t: [ticket("c1", { parentId: "t" })], c1: [ticket("c2")] },
  });

  await service.moveToProject(actor, "t", "dst");

  expect(repository.moveToProject).toHaveBeenCalledTimes(3);
  expect(repository.moveToProject).toHaveBeenCalledWith(
    "t",
    expect.objectContaining({ key: "DST-10", number: 10, projectId: "dst" }),
  );
  expect(history.recordProjectMove).toHaveBeenCalledTimes(3);
  expect(cache.invalidateWorkItems).toHaveBeenCalledTimes(1);
  expect(cache.invalidateLabels).toHaveBeenCalledTimes(1);
});

it("keeps parent, milestone and assignee that fit the target", async () => {
  const { repository, service } = setup({
    children: {
      t: [
        ticket("c1", {
          assigneeId: "a",
          milestoneId: "m",
          parentId: "t",
        }),
      ],
    },
  });

  await service.moveToProject(actor, "t", "dst");

  expect(repository.moveToProject).toHaveBeenCalledWith(
    "c1",
    expect.objectContaining({
      assigneeId: "a",
      milestoneId: "m",
      parentId: "t",
    }),
  );
});

it("clears references that cannot travel", async () => {
  const { repository, service } = setup({
    children: {
      t: [ticket("c1", { assigneeId: "a", milestoneId: "m", parentId: "x" })],
    },
    eligible: false,
    milestone: null,
  });

  await service.moveToProject(actor, "t", "dst");

  expect(repository.moveToProject).toHaveBeenCalledWith(
    "c1",
    expect.objectContaining({
      assigneeId: null,
      milestoneId: null,
      parentId: null,
    }),
  );
});

it("clears a milestone of another project", async () => {
  const { repository, service } = setup({
    children: { t: [ticket("c1", { milestoneId: "m" })] },
    milestone: { projectId: "other" },
  });

  await service.moveToProject(actor, "t", "dst");

  expect(repository.moveToProject).toHaveBeenCalledWith(
    "c1",
    expect.objectContaining({ milestoneId: null }),
  );
});

it("rejects a move into the same project", async () => {
  const { service } = setup({ sameProject: true });

  await expect(service.moveToProject(actor, "t", "dst")).rejects.toMatchObject({
    code: "moveSameProject",
  });
});

it("rejects a move of a missing root", async () => {
  const { service } = setup({ root: null });

  await expect(service.moveToProject(actor, "t", "dst")).rejects.toThrow();
});

it("fails when the moved item cannot be read back", async () => {
  const { repository, service } = setup();
  repository.findById
    .mockResolvedValueOnce(ticket("t"))
    .mockResolvedValueOnce(null);

  await expect(service.moveToProject(actor, "t", "dst")).rejects.toThrow(
    "Moved work item could not be retrieved.",
  );
});

it("moves conditionally against the displayed snapshot", async () => {
  const { history, repository, service } = setup({
    children: { t: [ticket("c1", { parentId: "t" })] },
  });

  await service.moveToProject(actor, "t", "dst", snapshot(null));

  expect(repository.moveSubtreeIfCurrent).toHaveBeenCalledWith(
    "t",
    expect.arrayContaining([
      expect.objectContaining({ id: "t" }),
      expect.objectContaining({ id: "c1" }),
    ]),
  );
  expect(history.recordProjectMove).toHaveBeenCalledTimes(2);
});

it("keeps the expected parent of a root that has one", async () => {
  const { repository, service } = setup({
    root: ticket("t", { parentId: "p" }),
  });

  await service.moveToProject(actor, "t", "dst", snapshot("p"));

  expect(repository.moveSubtreeIfCurrent).toHaveBeenCalledTimes(1);
});

it("rejects a conditional move whose snapshot is outdated", async () => {
  const { service } = setup({ conditionalMoved: false });

  await expect(
    service.moveToProject(actor, "t", "dst", snapshot(null)),
  ).rejects.toMatchObject({ code: "ticketConflict" });
});

it("rejects a conditional move of an empty subtree", async () => {
  const { service } = setup();
  const move = {
    expected: snapshot(null),
    subtree: [],
    targetProject: { id: "dst", name: "Dest" },
  } as unknown as Parameters<(typeof service)["moveSubtreeIfCurrent"]>[1];

  await expect(
    service["moveSubtreeIfCurrent"](
      actor,
      move,
      { firstNumber: 1, projectKey: "DST" },
      snapshot(null),
    ),
  ).rejects.toThrow();
});
