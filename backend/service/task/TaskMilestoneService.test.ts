import { expect, it, vi } from "vitest";

import { TaskMilestoneService } from "./TaskMilestoneService";

import {
  WorkItemConflictError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import type { MilestoneFieldInput } from "./TaskMilestoneService";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { User } from "@/definition/User";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const actor = doubleOf<User>({ id: "u1" });

const stored = {
  description: "desc",
  dueAt: "2026-02-01",
  id: "m1",
  name: "Name",
  projectId: "p1",
  startAt: "2026-01-01",
  status: "open",
};

interface Facts {
  readonly milestone?: object | null;
  readonly isFieldUpdated?: boolean;
  readonly dependencies?: object[];
  readonly milestones?: object[];
  readonly isReadable?: boolean;
}

function setup(facts: Facts = {}): {
  readonly service: TaskMilestoneService;
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
  readonly access: Record<string, ReturnType<typeof vi.fn>>;
  readonly invalidate: ReturnType<typeof vi.fn>;
} {
  const insertedIds: string[] = [];
  const repository = {
    archiveMilestone: vi.fn(async () => {}),
    deleteDependenciesByMilestone: vi.fn(async () => {}),
    deleteDependency: vi.fn(async () => {}),
    findDependenciesByProjectIds: vi.fn(async () => [
      ...(facts.dependencies ?? []),
      ...(facts.isReadable
        ? insertedIds.map((id) => ({ id, sourceId: "a" }))
        : []),
    ]),
    findMilestoneById: vi.fn(async () =>
      facts.milestone === undefined ? stored : facts.milestone,
    ),
    findMilestonesByProjectIds: vi.fn(
      async () => facts.milestones ?? [{ id: "a" }, { id: "b" }],
    ),
    insertDependency: vi.fn(async (input: { id: string }) => {
      insertedIds.push(input.id);
    }),
    insertMilestone: vi.fn(async () => {}),
    updateMilestone: vi.fn(async () => {}),
    updateMilestoneField: vi.fn(async () => facts.isFieldUpdated ?? true),
  };
  const access = {
    requireArchiveRight: vi.fn(async () => {}),
    requirePlanningProject: vi.fn(async () => {}),
    requireProject: vi.fn(async () => {}),
    resolveAccessibleProjectIds: vi.fn(async () => ["p1"]),
  };
  const invalidate = vi.fn();

  return {
    access,
    invalidate,
    repository,
    service: new TaskMilestoneService(
      doubleOf<TaskRepository>(repository),
      doubleOf<TaskAccessGuard>(access),
      doubleOf<ServerCache>({ invalidateWorkItems: invalidate }),
    ),
  };
}

it("lists milestones and dependencies of accessible projects", async () => {
  const { repository, service } = setup({ dependencies: [{ id: "d" }] });

  await service.findMilestones(actor, ["p1", "p2"]);
  await expect(service.findDependencies(actor, ["p1"])).resolves.toEqual([
    { id: "d" },
  ]);
  expect(repository.findMilestonesByProjectIds).toHaveBeenCalledWith(["p1"]);
});

it("creates a milestone", async () => {
  const { invalidate, repository, service } = setup();

  await expect(
    service.createMilestone(actor, { name: " N ", projectId: "p1" }),
  ).resolves.toEqual(stored);
  expect(repository.insertMilestone).toHaveBeenCalledWith(
    expect.objectContaining({ description: "", name: "N", projectId: "p1" }),
  );
  expect(invalidate).toHaveBeenCalled();
});

it("fails when a created milestone cannot be read back", async () => {
  const { service } = setup({ milestone: null });

  await expect(
    service.createMilestone(actor, {
      description: " d ",
      name: "N",
      projectId: "p1",
    }),
  ).rejects.toThrow("Created milestone");
});

const update = {
  description: " d ",
  dueAt: null,
  name: "N",
  status: "completed",
} as const;

it("updates a milestone", async () => {
  const { repository, service } = setup();

  await service.updateMilestone(actor, "m1", update);

  expect(repository.updateMilestone).toHaveBeenCalledWith(
    "m1",
    expect.objectContaining({ description: "d", status: "completed" }),
  );
});

it("rejects an update of an unknown milestone or status", async () => {
  const missing = setup({ milestone: null });
  const { service } = setup();

  await expect(
    missing.service.updateMilestone(actor, "m1", update),
  ).rejects.toThrow(WorkItemValidationError);
  await expect(
    service.updateMilestone(actor, "m1", {
      ...update,
      status: doubleOf<"open">("bogus"),
    }),
  ).rejects.toThrow(WorkItemValidationError);
});

it("fails when an updated milestone cannot be read back", async () => {
  const { repository, service } = setup();

  repository.findMilestoneById
    .mockResolvedValueOnce(stored)
    .mockResolvedValueOnce(null);

  await expect(service.updateMilestone(actor, "m1", update)).rejects.toThrow(
    "Updated milestone",
  );
});

function change(
  field: MilestoneFieldInput["field"],
  base: string | null,
  value: string | null,
): MilestoneFieldInput {
  return { base, field, value };
}

it("changes each single field", async () => {
  const { repository, service } = setup();

  for (const input of [
    change("name", "Name", "New"),
    change("description", "desc", " other "),
    change("status", "open", "archived"),
    change("startAt", "2026-01-01", "2026-01-15"),
    change("dueAt", "2026-02-01", "2026-03-01"),
  ]) {
    await expect(
      service.updateMilestoneField(actor, "m1", input),
    ).resolves.toMatchObject({ isChanged: true });
  }

  expect(repository.updateMilestoneField).toHaveBeenCalledTimes(5);
});

it("treats a null value of text fields as empty", async () => {
  const { service } = setup();

  await expect(
    service.updateMilestoneField(
      actor,
      "m1",
      change("description", "desc", null),
    ),
  ).resolves.toMatchObject({ isChanged: true });
  await expect(
    service.updateMilestoneField(actor, "m1", change("name", "Name", null)),
  ).rejects.toThrow(WorkItemValidationError);
});

it("rejects an unsupported status value", async () => {
  const { service } = setup();

  await expect(
    service.updateMilestoneField(actor, "m1", change("status", "open", "x")),
  ).rejects.toThrow(WorkItemValidationError);
});

it("writes nothing when the milestone already has the value", async () => {
  const { repository, service } = setup();

  await expect(
    service.updateMilestoneField(actor, "m1", change("name", "Old", "Name")),
  ).resolves.toEqual({ isChanged: false, milestone: stored });
  await expect(
    service.updateMilestoneField(actor, "m1", change("name", "Name", "Name")),
  ).resolves.toMatchObject({ isChanged: false });
  expect(repository.updateMilestoneField).not.toHaveBeenCalled();
});

it("raises a conflict when the field changed meanwhile", async () => {
  const { service } = setup();

  await expect(
    service.updateMilestoneField(actor, "m1", change("name", "Old", "New")),
  ).rejects.toThrow(WorkItemConflictError);
});

it("raises a conflict when the guarded write is refused", async () => {
  const { service } = setup({ isFieldUpdated: false });

  await expect(
    service.updateMilestoneField(actor, "m1", change("name", "Name", "New")),
  ).rejects.toThrow(WorkItemConflictError);
});

it("fails when a changed field cannot be read back", async () => {
  const { repository, service } = setup();

  repository.findMilestoneById
    .mockResolvedValueOnce(stored)
    .mockResolvedValueOnce(null);

  await expect(
    service.updateMilestoneField(actor, "m1", change("name", "Name", "New")),
  ).rejects.toThrow("Updated milestone");
});

it("archives a milestone with its dependencies", async () => {
  const { access, invalidate, repository, service } = setup();

  await service.archiveMilestone(actor, "m1");

  expect(access.requireArchiveRight).toHaveBeenCalledWith(actor, "p1");
  expect(repository.deleteDependenciesByMilestone).toHaveBeenCalledWith("m1");
  expect(repository.archiveMilestone).toHaveBeenCalledWith("m1");
  expect(invalidate).toHaveBeenCalled();
});

it("refuses to archive an unknown milestone", async () => {
  const { service } = setup({ milestone: null });

  await expect(service.requireArchivableMilestone(actor, "m1")).rejects.toThrow(
    WorkItemValidationError,
  );
});

const link = {
  linkType: "blocks",
  projectId: "p1",
  sourceId: "a",
  targetId: "b",
} as const;

it("adds a dependency between two milestones", async () => {
  const { service } = setup({ isReadable: true });

  await expect(service.addDependency(actor, link)).resolves.toMatchObject({
    sourceId: "a",
  });
});

it("fails when a created dependency cannot be read back", async () => {
  const { service } = setup();

  await expect(service.addDependency(actor, link)).rejects.toThrow(
    "Created dependency",
  );
});

it("rejects invalid dependencies", async () => {
  const { service } = setup();
  const exists = setup({
    dependencies: [{ sourceId: "b", targetId: "a" }],
  });
  const forward = setup({
    dependencies: [{ sourceId: "a", targetId: "b" }],
  });
  const partial = setup({
    dependencies: [
      { sourceId: "a", targetId: "x" },
      { sourceId: "x", targetId: "a" },
    ],
  });
  const noSource = setup({ milestones: [{ id: "b" }] });
  const noTarget = setup({ milestones: [{ id: "a" }] });

  await expect(
    service.addDependency(actor, {
      ...link,
      linkType: doubleOf<"blocks">("x"),
    }),
  ).rejects.toThrow(WorkItemValidationError);
  await expect(
    service.addDependency(actor, { ...link, targetId: "a" }),
  ).rejects.toThrow(WorkItemValidationError);
  await expect(exists.service.addDependency(actor, link)).rejects.toThrow(
    "already",
  );
  await expect(forward.service.addDependency(actor, link)).rejects.toThrow(
    WorkItemValidationError,
  );
  await expect(noSource.service.addDependency(actor, link)).rejects.toThrow(
    WorkItemValidationError,
  );
  await expect(noTarget.service.addDependency(actor, link)).rejects.toThrow(
    WorkItemValidationError,
  );
  await expect(partial.service.addDependency(actor, link)).rejects.toThrow(
    "Created dependency",
  );
});

it("removes a dependency of the project only", async () => {
  const { invalidate, repository, service } = setup({
    dependencies: [{ id: "d1" }],
  });

  await service.removeDependency(actor, "p1", "d1");
  await expect(service.removeDependency(actor, "p1", "zz")).rejects.toThrow(
    WorkItemValidationError,
  );

  expect(repository.deleteDependency).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledTimes(1);
});
