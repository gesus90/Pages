import { expect, it, vi } from "vitest";

import { McpAgentService } from "@/backend/service/mcp/agent/McpAgentService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";
import type { AgentTemplateService } from "@/backend/service/employee/AgentTemplateService";
import type { AgentEmployee } from "@/definition/AgentEmployee";

const AGENT = partial<AgentEmployee>({
  id: "agent",
  username: "ada",
  displayName: "Ada",
  position: "Engineer",
  isActive: true,
  revision: 2,
  cost: { spent: 0, unknownSessions: 1 },
  settings: { connectionId: "model", model: "name", access: "default" },
  memoryUsage: { archiveWords: 3 },
  learning: { isEnabled: true },
  documents: { soul: "soul", instructions: "instructions" },
});

it("filters agents by text and activity and omits unknown-only costs", async () => {
  const administration = partial<AgentEmployeeAdministration>({
    employees: async () => [
      AGENT,
      {
        ...AGENT,
        id: "other",
        displayName: "Grace",
        username: "grace",
        isActive: false,
      },
    ],
  });
  const service = new McpAgentService(
    administration,
    partial<AgentTemplateService>({}),
  );
  await expect(
    service.list("actor", { text: " ENGINEER ", status: "active" }),
  ).resolves.toMatchObject({
    agents: [{ id: "agent", costUsdThisMonth: null }],
  });
  await expect(service.list("actor", { text: "grace" })).resolves.toMatchObject(
    { agents: [{ id: "other" }] },
  );
});

it("rejects stale revisions and uses the activation operation for activation-only changes", async () => {
  const setActive = vi.fn(async () => {});
  const administration = partial<AgentEmployeeAdministration>({
    detail: async () => ({ agent: AGENT }),
    setActive,
  });
  const service = new McpAgentService(
    administration,
    partial<AgentTemplateService>({}),
  );
  await expect(
    service.update("actor", "agent", { revision: 1, isActive: false }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    service.update("actor", "agent", { revision: 2, isActive: false }),
  ).resolves.toMatchObject({ agent: { id: "agent" } });
  expect(setActive).toHaveBeenCalledWith("actor", "agent", {
    revision: 2,
    isActive: false,
  });
});
