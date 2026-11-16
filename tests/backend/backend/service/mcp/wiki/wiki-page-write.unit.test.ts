import { expect, it, vi } from "vitest";

import { McpWikiPageService } from "@/backend/service/mcp/wiki/McpWikiPageService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpWikiContext } from "@/backend/service/mcp/wiki/McpWikiContext";
import type { WikiPageView } from "@/definition/Wiki";

const VIEW = partial<WikiPageView>({
  page: {
    id: "page",
    title: "Title",
    content: "Before text after",
    icon: "icon",
    revision: 3,
    anchors: [],
    breadcrumb: [],
  },
  children: [],
  permissions: { canEdit: true, canManage: true, canComment: true },
});

it("saves a unique replacement at the expected revision and keeps the prior version", async () => {
  const update = vi.fn(async () => ({ revision: 4 }));
  const context = partial<McpWikiContext>({
    actor: { id: "actor" },
    atomically: async (work: () => Promise<unknown>) => work(),
    page: async () => VIEW,
    person: async () => null,
    services: { wiki: { update } },
  });
  const service = new McpWikiPageService();
  await expect(
    service.patch(context, "page", {
      expectedRevision: 3,
      oldText: "text",
      newText: "replacement",
    }),
  ).resolves.toMatchObject({ page: { id: "page", revision: 3 } });
  expect(update).toHaveBeenCalledWith(context.actor, "page", {
    title: "Title",
    content: "Before replacement after",
    icon: "icon",
    expectedRevision: 3,
    coalesceVersions: false,
  });
});

it("refuses a stale revision or ambiguous patch before writing", async () => {
  const update = vi.fn();
  const context = partial<McpWikiContext>({
    actor: { id: "actor" },
    atomically: async (work: () => Promise<unknown>) => work(),
    page: async () => VIEW,
    services: { wiki: { update } },
  });
  const service = new McpWikiPageService();
  await expect(
    service.update(context, "page", { expectedRevision: 2, title: "New" }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    service.patch(context, "page", {
      expectedRevision: 3,
      oldText: "missing",
      newText: "new",
    }),
  ).rejects.toMatchObject({ code: "text_not_found" });
  expect(update).not.toHaveBeenCalled();
});
