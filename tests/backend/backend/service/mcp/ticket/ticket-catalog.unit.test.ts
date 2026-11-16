import { expect, it, vi } from "vitest";

import { McpTicketCatalogService } from "@/backend/service/mcp/ticket/McpTicketCatalogService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpTicketContext } from "@/backend/service/mcp/ticket/McpTicketContext";

it("updates only named label fields and previews usage before deletion", async () => {
  const label = { id: "label", name: "Old", color: "blue" };
  const updateLabel = vi.fn(async () => ({ ...label, name: "New" }));
  const deleteLabel = vi.fn();
  const context = partial<McpTicketContext>({
    actor: { id: "user" },
    services: {
      tasks: {
        findLabels: async () => [label],
        updateLabel,
        deleteLabel,
        actionPermissions: async () => ({ canWrite: true }),
        countLabelUsage: async () => new Map([["label", 3]]),
      },
    },
  });
  const service = new McpTicketCatalogService();
  await expect(
    service.updateLabel(context, "label", { name: "New" }),
  ).resolves.toEqual({ id: "label", name: "New", color: "blue" });
  expect(updateLabel).toHaveBeenCalledWith(context.actor, "label", {
    name: "New",
    color: "blue",
  });
  await expect(service.deleteLabel(context, "label", false)).resolves.toEqual({
    confirmationRequired: true,
    label,
    usageCount: 3,
  });
  expect(deleteLabel).not.toHaveBeenCalled();
});

it("rejects incompatible template share targets before reading a ticket", async () => {
  const ticket = vi.fn();
  const context = partial<McpTicketContext>({ ticket });
  await expect(
    new McpTicketCatalogService().saveTemplate(
      context,
      partial({
        ticket: "P-1",
        name: "Template",
        scope: "private",
        projectIds: ["project"],
      }),
    ),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(ticket).not.toHaveBeenCalled();
});
