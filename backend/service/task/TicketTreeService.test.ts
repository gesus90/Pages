import { expect, it, vi } from "vitest";

import { TicketTreeService } from "./TicketTreeService";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type { WorkItemTreeRepository } from "@/backend/database/repositories/task/WorkItemTreeRepository";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const actor = doubleOf<User>({ id: "u1" });

function setup(expandedCount = 0): {
  readonly service: TicketTreeService;
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
} {
  const repository = {
    countExpanded: vi.fn(async () => expandedCount),
    findExpandedKeys: vi.fn(async () => ["k"]),
    setExpanded: vi.fn(async () => {}),
  };
  const item = doubleOf<WorkItemDetail>({
    extra: "dropped",
    id: "t1",
    isDone: false,
    key: "A-1",
    parentId: null,
    projectId: "p",
    projectName: "P",
    statusKey: "open",
    statusName: "Open",
    title: "T",
    type: "task",
  });

  return {
    repository,
    service: new TicketTreeService(
      doubleOf<WorkItemTreeRepository>(repository),
      { findAll: vi.fn(async () => [item]) },
    ),
  };
}

it("maps the tickets to compact entries", async () => {
  const { service } = setup();

  await expect(service.findEntries(actor)).resolves.toEqual([
    {
      id: "t1",
      isDone: false,
      key: "A-1",
      parentId: null,
      projectId: "p",
      projectName: "P",
      statusKey: "open",
      statusName: "Open",
      title: "T",
      type: "task",
    },
  ]);
});

it("lists the expanded keys of the actor", async () => {
  const { repository, service } = setup();

  await expect(service.findExpandedKeys(actor)).resolves.toEqual(["k"]);
  expect(repository.findExpandedKeys).toHaveBeenCalledWith("u1");
});

it("rejects a key of an unknown form", async () => {
  const { repository, service } = setup();

  await expect(service.setExpanded(actor, "bad key!", true)).rejects.toThrow(
    WorkItemValidationError,
  );
  expect(repository.setExpanded).not.toHaveBeenCalled();
});

it("stores an opened branch below the bound", async () => {
  const { repository, service } = setup(499);

  await service.setExpanded(actor, "project:p1", true);

  expect(repository.setExpanded).toHaveBeenCalledWith("u1", "project:p1", true);
});

it("keeps further branches closed at the bound", async () => {
  const { repository, service } = setup(500);

  await service.setExpanded(actor, "t1", true);

  expect(repository.setExpanded).not.toHaveBeenCalled();
});

it("closes a branch without counting", async () => {
  const { repository, service } = setup(500);

  await service.setExpanded(actor, "t1", false);

  expect(repository.countExpanded).not.toHaveBeenCalled();
  expect(repository.setExpanded).toHaveBeenCalledWith("u1", "t1", false);
});
