import { expect, it, vi } from "vitest";

import { TaskLinkService } from "@/backend/service/task/TaskLinkService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { User } from "@/definition/User";

const actor = partial<User>({ id: "person" });

it("resolves a trimmed target, checks both projects and saves a link", async () => {
  const findByKey = vi.fn(async () => ({ id: "target", projectId: "other" }));
  const insertLink = vi.fn(async () => undefined);
  const findLinksByWorkItemId = vi.fn(async () => []);
  const requireWritableWorkItem = vi.fn(async () => ({
    id: "source",
    projectId: "project",
  }));
  const requireProject = vi.fn(async () => undefined);
  const service = new TaskLinkService(
    partial<TaskRepository>({ findByKey, insertLink, findLinksByWorkItemId }),
    partial<TaskAccessGuard>({
      requireWritableWorkItem,
      requireProject,
      visibility: async () => ({}),
    }),
  );
  await expect(
    service.addLink(actor, "source", " KEY-1 ", "blocks"),
  ).resolves.toEqual([]);
  expect(findByKey).toHaveBeenCalledWith("KEY-1", expect.anything());
  expect(requireProject).toHaveBeenCalledWith(actor, "other");
  expect(insertLink).toHaveBeenCalledWith(
    expect.objectContaining({
      workItemId: "source",
      linkedWorkItemId: "target",
      linkType: "blocks",
    }),
  );
});

it("refuses missing, self and unrelated links before changing storage", async () => {
  const findByKey = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: "source" });
  const insertLink = vi.fn();
  const deleteLink = vi.fn();
  const findLinkById = vi.fn(async () => ({
    workItemId: "other",
    linkedWorkItemId: "different",
  }));
  const service = new TaskLinkService(
    partial<TaskRepository>({
      findByKey,
      insertLink,
      deleteLink,
      findLinkById,
    }),
    partial<TaskAccessGuard>({
      requireWritableWorkItem: async () => ({ id: "source" }),
      visibility: async () => ({}),
    }),
  );
  await expect(
    service.addLink(actor, "source", "missing", "blocks"),
  ).rejects.toMatchObject({ code: "linkTargetNotFound" });
  await expect(
    service.addLink(actor, "source", "self", "blocks"),
  ).rejects.toMatchObject({ code: "linkSelf" });
  await expect(
    service.removeLink(actor, "source", "link"),
  ).rejects.toMatchObject({ code: "linkNotOfTicket" });
  expect(insertLink).not.toHaveBeenCalled();
  expect(deleteLink).not.toHaveBeenCalled();
});
