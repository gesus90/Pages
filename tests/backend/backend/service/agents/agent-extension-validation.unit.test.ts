import { expect, it, vi } from "vitest";

import { AgentExtensionService } from "@/backend/service/agents/AgentExtensionService";
import { AGENT_EXTENSION_WRITE_OPERATIONS } from "@/definition/AgentExtensions";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentIdentity } from "@/definition/McpAuthorization";

const IDENTITY = partial<AgentIdentity>({ userId: "user" });

it("leaves operations owned by other dispatchers untouched", async () => {
  const transaction = vi.fn();
  const service = new AgentExtensionService(
    partial({ database: { transaction } }),
  );
  await expect(
    service.handle(IDENTITY, "other.operation", {}),
  ).resolves.toBeNull();
  expect(transaction).not.toHaveBeenCalled();
});

it.each(AGENT_EXTENSION_WRITE_OPERATIONS)(
  "refuses incomplete %s before opening a transaction",
  async (operation) => {
    const transaction = vi.fn();
    const service = new AgentExtensionService(
      partial({ database: { transaction } }),
    );
    await expect(
      service.handle(IDENTITY, operation, { operationId: "operation" }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(transaction).not.toHaveBeenCalled();
  },
);

it("rejects extra read selectors before consulting the planning service", async () => {
  const readProjectTickets = vi.fn();
  const service = new AgentExtensionService(
    partial({ database: {}, planning: { readProjectTickets } }),
  );
  await expect(
    service.handle(IDENTITY, "projects.tickets.list", {
      projectId: "project",
      unexpected: true,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(readProjectTickets).not.toHaveBeenCalled();
});
