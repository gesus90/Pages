import { expect, it, vi } from "vitest";

import { TaskLinkService } from "./TaskLinkService";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { User } from "@/definition/User";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const actor = doubleOf<User>({ id: "u1" });

interface Facts {
  readonly target?: object | null;
  readonly link?: object | null;
}

function setup(facts: Facts = {}): {
  readonly service: TaskLinkService;
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
  readonly access: Record<string, ReturnType<typeof vi.fn>>;
} {
  const repository = {
    deleteLink: vi.fn(async () => {}),
    findByKey: vi.fn(async () =>
      facts.target === undefined ? { id: "t2", projectId: "p2" } : facts.target,
    ),
    findLinkById: vi.fn(async () =>
      facts.link === undefined ? null : facts.link,
    ),
    findLinksByWorkItemId: vi.fn(async () => [{ id: "l" }]),
    insertLink: vi.fn(async () => {}),
  };
  const access = {
    requireProject: vi.fn(async () => {}),
    requireWorkItem: vi.fn(async () => ({ id: "t1" })),
    requireWritableWorkItem: vi.fn(async () => ({ id: "t1" })),
    visibility: vi.fn(async () => "visible"),
  };

  return {
    access,
    repository,
    service: new TaskLinkService(
      doubleOf<TaskRepository>(repository),
      doubleOf<TaskAccessGuard>(access),
    ),
  };
}

it("lists the links of a work item", async () => {
  const { repository, service } = setup();

  await expect(service.findLinks(actor, "t1")).resolves.toEqual([{ id: "l" }]);
  expect(repository.findLinksByWorkItemId).toHaveBeenCalledWith(
    "t1",
    "visible",
  );
});

it("adds a link to the ticket with the given key", async () => {
  const { access, repository, service } = setup();

  await expect(
    service.addLink(actor, "t1", " B-2 ", "blocks"),
  ).resolves.toEqual([{ id: "l" }]);
  expect(repository.findByKey).toHaveBeenCalledWith("B-2", "visible");
  expect(access.requireProject).toHaveBeenCalledWith(actor, "p2");
  expect(repository.insertLink).toHaveBeenCalledWith(
    expect.objectContaining({
      linkType: "blocks",
      linkedWorkItemId: "t2",
      workItemId: "t1",
    }),
  );
});

it("rejects an unsupported link type", async () => {
  const { service } = setup();

  await expect(
    service.addLink(actor, "t1", "B-2", doubleOf<"blocks">("nope")),
  ).rejects.toThrow(WorkItemValidationError);
});

it("rejects an empty or unknown target key", async () => {
  const empty = setup();
  const unknown = setup({ target: null });

  await expect(
    empty.service.addLink(actor, "t1", "  ", "blocks"),
  ).rejects.toThrow(WorkItemValidationError);
  expect(empty.repository.findByKey).not.toHaveBeenCalled();
  await expect(
    unknown.service.addLink(actor, "t1", "X-9", "blocks"),
  ).rejects.toThrow(WorkItemValidationError);
});

it("rejects a link to the work item itself", async () => {
  const { service } = setup({ target: { id: "t1", projectId: "p" } });

  await expect(service.addLink(actor, "t1", "A-1", "blocks")).rejects.toThrow(
    WorkItemValidationError,
  );
});

it("removes a link in either direction or an unknown one", async () => {
  const outgoing = setup({ link: { linkedWorkItemId: "x", workItemId: "t1" } });
  const incoming = setup({ link: { linkedWorkItemId: "t1", workItemId: "x" } });
  const unknown = setup();

  await expect(outgoing.service.removeLink(actor, "t1", "l")).resolves.toEqual([
    { id: "l" },
  ]);
  await incoming.service.removeLink(actor, "t1", "l");
  await unknown.service.removeLink(actor, "t1", "l");
  expect(unknown.repository.deleteLink).toHaveBeenCalledWith("l");
});

it("refuses to remove a link of another ticket", async () => {
  const { repository, service } = setup({
    link: { linkedWorkItemId: "y", workItemId: "x" },
  });

  await expect(service.removeLink(actor, "t1", "l")).rejects.toThrow(
    WorkItemValidationError,
  );
  expect(repository.deleteLink).not.toHaveBeenCalled();
});
