import { expect, it, vi } from "vitest";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import { managementFixture } from "./page316-service-fixture";

import type { AgentEmployeeInput } from "@/backend/service/employee/AgentEmployeeInput";
import type { AgentEmployee } from "@/definition/AgentEmployee";

type Fixture = ReturnType<typeof managementFixture>;

/** The agent as the administration reads it back after the given input was created. */
function agentEmployeeFor(
  id: string,
  input: AgentEmployeeInput,
): AgentEmployee {
  return {
    id,
    username: input.username,
    displayName: input.displayName,
    position: null,
    avatarColor: null,
    avatarImageUrl: null,
    isActive: true,
    modelName: input.settings.model,
    provider: "codex",
    roleId: input.roleId,
    roleName: "Employee",
    departmentIds: input.departments,
    settings: input.settings,
    documents: input.documents,
    voice: input.voice,
    memory: "",
    dream: "",
    memoryLimits: input.limits,
    memoryUsage: { coreWords: 0, archiveWords: 0 },
    learning: {
      isEnabled: false,
      dreamTime: "01:00",
      lastRunAt: null,
      nextRunAt: null,
      lastResult: null,
    },
    cost: { spent: 0, unknownSessions: 0, month: "2026-11" },
    revision: 1,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };
}

/** Replaces the agent administration with an in-memory one that keeps a single agent. */
function mockAgentAdministration({ world, agents }: Fixture): void {
  let employee: AgentEmployee | null = null;
  vi.spyOn(agents, "create").mockImplementation(async (actorId, input) => {
    const account = world.addAccount({
      userId: "new-agent",
      roleId: input.roleId,
      departments: input.departments,
      username: input.username,
    });
    world.store.accounts.set(account.userId, { ...account, isAgent: true });
    employee = agentEmployeeFor(account.userId, input);
    return account.userId;
  });
  vi.spyOn(agents, "detail").mockImplementation(async () => {
    if (!employee) throw new Error("Agent not created");
    return {
      agent: employee,
      memoryDetails: { archive: [], versions: [] },
      activity: [],
      canEdit: true,
      canChangeAccess: false,
      accessEnvironment: { isIsolationAvailable: false, mcpServers: [] },
    };
  });
  vi.spyOn(agents, "update").mockImplementation(async (actorId, id, change) => {
    if (!employee) throw new Error("Agent not created");
    employee = {
      ...employee,
      documents: change.input.documents,
      settings: change.input.settings,
      revision: employee.revision + 1,
    };
  });
  vi.spyOn(agents, "setActive").mockImplementation(
    async (actorId, id, change) => {
      world.setUserActive(id, change.isActive);
      if (!employee) throw new Error("Agent not created");
      employee = {
        ...employee,
        isActive: change.isActive,
        revision: employee.revision + 1,
      };
    },
  );
}

it("creates, reads, updates and deactivates an agent through the shared contract", async () => {
  const fixture = managementFixture();
  mockAgentAdministration(fixture);
  const { service, agents } = fixture;
  await service.call("management", "users_create", {
    kind: "agent",
    displayName: "Agent",
    username: "new-agent",
    role: "role-employee",
    departmentIds: ["legal"],
    groupIds: [],
    agent: {
      agentMd: "Do work",
      soulMd: "Be kind",
      connectionId: "released",
      model: "model",
      reasoningEffort: "high",
    },
  });
  expect(agents.create).toHaveBeenCalledWith(
    "management",
    expect.objectContaining({
      documents: { instructions: "Do work", soul: "Be kind" },
      settings: {
        access: "read_only",
        connectionId: "released",
        model: "model",
        reasoningEffort: "high",
      },
    }),
    null,
  );
  const read = await service.call("management", "users_read", {
    userId: "new-agent",
  });
  if (!("revision" in read)) throw new Error("Missing revision");
  expect(read).toMatchObject({
    kind: "agent",
    agent: { agentMd: "Do work", soulMd: "Be kind", model: "model" },
  });
  const update = await service.call("management", "users_update", {
    userId: "new-agent",
    expectedRevision: read.revision,
    agent: {
      agentMd: "Changed",
      soulMd: "Still kind",
      connectionId: "released",
      model: "other-model",
      reasoningEffort: null,
    },
  });
  if (!("revision" in update)) throw new Error("Missing revision");
  expect(
    await service.call("management", "users_read", { userId: "new-agent" }),
  ).toMatchObject({ agent: { agentMd: "Changed", model: "other-model" } });
  expect(
    await service.call("management", "users_set_status", {
      userId: "new-agent",
      expectedRevision: update.revision,
      status: "deactivated",
    }),
  ).toMatchObject({ id: "new-agent", status: "deactivated" });
});

it("returns a safe validation error when the released model boundary refuses a model", async () => {
  const { service, agents } = managementFixture();
  vi.spyOn(agents, "create").mockRejectedValue(
    new AgentEmployeeError("modelNotAllowed"),
  );
  await expect(
    service.call("management", "users_create", {
      kind: "agent",
      displayName: "Agent",
      username: "agent",
      role: "role-employee",
      departmentIds: [],
      groupIds: [],
      agent: {
        agentMd: "",
        soulMd: "",
        connectionId: "unreleased",
        model: "bad",
        reasoningEffort: null,
      },
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "modelNotAllowed" },
  });
});
