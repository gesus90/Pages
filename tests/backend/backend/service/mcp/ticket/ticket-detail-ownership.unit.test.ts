import { expect, it, vi } from "vitest";

import { McpTicketDetailService } from "@/backend/service/mcp/ticket/McpTicketDetailService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpTicketContext } from "@/backend/service/mcp/ticket/McpTicketContext";

it("refuses checklist items and attachments belonging to another ticket", async () => {
  const setChecklistItemDone = vi.fn();
  const open = vi.fn();
  const context = partial<McpTicketContext>({
    actor: { id: "user" },
    ticket: async () => ({ id: "ticket", archivedAt: null }),
    services: {
      tasks: {
        findChecklistItems: async () => [{ id: "own" }],
        setChecklistItemDone,
      },
      attachments: { list: async () => [{ id: "own" }], open },
    },
  });
  const service = new McpTicketDetailService();
  await expect(
    service.setChecklistItemDone(context, "P-1", "other", true),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(service.open(context, "P-1", "other")).rejects.toMatchObject({
    code: "not_found",
  });
  expect(setChecklistItemDone).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it("rejects a duplicate outgoing relationship before writing", async () => {
  const addLink = vi.fn();
  const context = partial<McpTicketContext>({
    actor: { id: "user" },
    ticket: async () => ({ id: "ticket", archivedAt: null }),
    services: {
      tasks: {
        findLinks: async () => [
          {
            linkType: "blocks",
            linkedWorkItemKey: "P-2",
            direction: "outgoing",
          },
        ],
        addLink,
      },
    },
  });
  await expect(
    new McpTicketDetailService().addLink(context, "P-1", {
      type: "blocks",
      target: " p-2 ",
    }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(addLink).not.toHaveBeenCalled();
});
