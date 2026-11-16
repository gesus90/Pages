import { expect, it, vi } from "vitest";

import { McpTicketLifecycleService } from "@/backend/service/mcp/ticket/McpTicketLifecycleService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpTicketContext } from "@/backend/service/mcp/ticket/McpTicketContext";

it("previews active descendants before archiving and performs no write", async () => {
  const archive = vi.fn();
  const findAll = vi.fn(
    async (actor: unknown, options: { parentId: string }) =>
      actor && options.parentId === "parent"
        ? [
            {
              id: "child",
              key: "P-2",
              title: "Child",
              projectId: "project",
              archivedAt: null,
            },
          ]
        : [],
  );
  const context = partial<McpTicketContext>({
    actor: { id: "user" },
    ticket: async () => ({
      id: "parent",
      key: "P-1",
      title: "Parent",
      type: "task",
      projectId: "project",
      archivedAt: null,
    }),
    services: {
      tasks: {
        describeDescendants: async () => ({ canArchive: true }),
        findAll,
        archive,
      },
    },
  });
  await expect(
    new McpTicketLifecycleService().archive(context, "P-1", {}),
  ).resolves.toEqual({
    confirmationRequired: true,
    ticket: { key: "P-1", title: "Parent" },
    affected: [
      { key: "P-1", title: "Parent" },
      { key: "P-2", title: "Child" },
    ],
  });
  expect(archive).not.toHaveBeenCalled();
});

it("rejects archive without permission or invalid child handling", async () => {
  const context = partial<McpTicketContext>({
    ticket: async () => ({ id: "ticket", type: "task" }),
    services: {
      tasks: { describeDescendants: async () => ({ canArchive: false }) },
    },
  });
  const service = new McpTicketLifecycleService();
  await expect(service.archive(context, "P-1", {})).rejects.toMatchObject({
    code: "forbidden",
  });
  const allowed = partial<McpTicketContext>({
    ...context,
    services: {
      tasks: { describeDescendants: async () => ({ canArchive: true }) },
    },
  });
  await expect(
    service.archive(allowed, "P-1", { children: "keep" }),
  ).rejects.toMatchObject({ code: "invalid_request" });
});
