import { expect, it, vi } from "vitest";

import { McpWikiLifecycleService } from "@/backend/service/mcp/wiki/McpWikiLifecycleService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpWikiContext } from "@/backend/service/mcp/wiki/McpWikiContext";

it("previews all affected pages after checking the revision", async () => {
  const remove = vi.fn();
  const pageAtRevision = vi.fn(async () => ({}));
  const context = partial<McpWikiContext>({
    actor: { id: "user" },
    pageAtRevision,
    services: {
      wiki: {
        findPlaceholder: async () => null,
        previewDelete: async () => ({
          page: { id: "page", title: "Page" },
          affected: [{ id: "child", title: "Child" }],
        }),
        delete: remove,
      },
    },
  });
  await expect(
    new McpWikiLifecycleService().delete(context, "page", {
      expectedRevision: 3,
    }),
  ).resolves.toEqual({
    confirmationRequired: true,
    page: { id: "page", title: "Page" },
    affected: [{ id: "child", title: "Child" }],
  });
  expect(pageAtRevision).toHaveBeenCalledWith("page", 3);
  expect(remove).not.toHaveBeenCalled();
});

it("does not reveal another person's private page title in its confirmation", async () => {
  const context = partial<McpWikiContext>({
    actor: { id: "admin" },
    services: {
      wiki: { findPlaceholder: async () => ({ id: "page", ownerId: "owner" }) },
    },
  });
  await expect(
    new McpWikiLifecycleService().delete(context, "page", {}),
  ).resolves.toEqual({
    confirmationRequired: true,
    placeholder: { id: "page", ownerId: "owner" },
  });
});
