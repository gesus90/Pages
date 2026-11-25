import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

const calls = vi.hoisted<{ reader: unknown; requireRemote: Mock }>(() => ({
  reader: null,
  requireRemote: vi.fn(),
}));

function stub(name: string): Record<string, Mock> {
  return {
    [name]: vi.fn(function (this: object) {
      Object.assign(this, { name });
    }),
  };
}

vi.mock("@/app/lib/remote-services.server", () => ({
  createRemoteServices: vi.fn(() => ({
    remoteWorkspaceService: "rws",
    remoteConnectionService: "rcs",
  })),
}));
vi.mock("@/app/lib/plan-access-services.server", () => ({
  createPlanWorkspaceAccess: vi.fn(() => ({
    access: "a",
    workspaceCatalog: "c",
  })),
}));
vi.mock("@/app/lib/agent-workspace-services.server", () => ({
  createAgentConfigurationServices: vi.fn(() => ({
    agentWorkspaceService: "aws",
    agentProfileService: "aps",
    agentParameterService: "apa",
  })),
}));
vi.mock("@/backend/database/repositories/AgentConnectionRepository", () =>
  stub("AgentConnectionRepository"),
);
vi.mock("@/backend/database/repositories/agent/AgentPlanRepository", () =>
  stub("AgentPlanRepository"),
);
vi.mock("@/backend/database/repositories/agent/AgentPlanRunRepository", () =>
  stub("AgentPlanRunRepository"),
);
vi.mock("@/backend/security/InstanceSecretCipher", () =>
  stub("InstanceSecretCipher"),
);
vi.mock("@/backend/service/agents/AgentOperationRegistry", () =>
  stub("AgentOperationRegistry"),
);
vi.mock("@/backend/service/agents/AgentPlanOwnerRunReader", () => ({
  AgentPlanOwnerRunReader: vi.fn(function (this: object, input: unknown) {
    calls.reader = input;
  }),
}));
vi.mock("@/backend/service/agents/AgentPlanRemoteTargets", () => ({
  AgentPlanRemoteTargets: vi.fn(function (this: object) {
    Object.assign(this, { name: "targets" });
  }),
  requireRemoteRunResources: calls.requireRemote,
}));
vi.mock("@/backend/service/agents/AgentPlanTasks", () =>
  stub("AgentPlanTasks"),
);

import { createIntegrationRunAccess } from "./IntegrationRunAccess";

describe("createIntegrationRunAccess", () => {
  it("wires the reader and delegates remote read checks", () => {
    const reader = createIntegrationRunAccess({
      database: {} as unknown as never,
      directory: "data",
      agentsDirectory: "agents",
      tokenKey: Buffer.alloc(32),
      services: { ticketAssets: {}, tasks: {}, users: {} } as unknown as never,
    });
    expect(reader).toBeDefined();
    const input = calls.reader as {
      remoteExecution: {
        requireRead: (user: string, resources: unknown) => void;
      };
    };
    input.remoteExecution.requireRead("user", ["r"]);
    expect(calls.requireRemote).toHaveBeenCalledWith(
      expect.anything(),
      "user",
      ["r"],
    );
  });
});
