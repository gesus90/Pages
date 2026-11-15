import { expect, it, vi } from "vitest";

import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentPlanConfigurationPins } from "@/backend/service/agents/AgentPlanConfigurationPins";
import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { resolveAgentAssignmentFor } from "@/backend/service/agents/AgentAssignmentResolution";
import { OpenCodeAgentCredentials } from "@/backend/service/agents/OpenCodeAgentCredentials";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import {
  acpRunOptions,
  isAgentRunOptionsAllowed,
} from "@/definition/AgentConfiguration";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";
import { emptyAgentPlan } from "@/definition/AgentPlan";
import { planConfigurationForModel } from "@/definition/AgentPlanConfiguration";

import { bareInstance } from "../tasks/bare-instance";
import { ACTOR, modelWorld, ZEN } from "../employee/page347-model-fixture";

import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentProviderId } from "@/definition/AgentConnection";

function world(provider: AgentProviderId): {
  readonly connection: AgentConnectionRecord;
  readonly connections: ReturnType<typeof modelWorld>["connections"];
  readonly profiles: AgentProfileService;
  readonly pins: AgentPlanConfigurationPins;
} {
  const { connections } = modelWorld();
  const connection: AgentConnectionRecord = {
    id: "selected",
    name: provider === "openrouter" ? "OpenRouter" : "z.AI",
    provider,
    hasApiKey: provider !== "opencode",
    isActive: true,
    testModel: null,
    reasoningEffort: null,
    cliAccountLabel: null,
    cliLoggedInAt: provider === "opencode" ? "today" : null,
    updatedAt: "today",
  };
  vi.mocked(connections.list).mockResolvedValue([connection]);
  vi.mocked(connections.find).mockResolvedValue(connection);
  vi.mocked(connections.catalogs().find).mockResolvedValue({
    ...emptyModelCatalog(),
    models: [
      {
        ...ZEN,
        id: "deepseek/deepseek-v4.1-flash",
        name: "DeepSeek",
        reasoning: "levels",
        reasoningEfforts: ["low", "high"],
      },
    ],
  });
  const stored = bareInstance(AgentProfileRepository.prototype);
  const authorization = bareInstance(AuthorizationRepository.prototype);
  const groups = bareInstance(UserGroupRepository.prototype);
  vi.spyOn(stored, "list").mockResolvedValue([]);
  vi.spyOn(authorization, "snapshot").mockResolvedValue({
    roles: [],
    departments: [],
    accounts: [ACTOR],
  });
  vi.spyOn(groups, "findIdsByMember").mockResolvedValue([]);
  const profiles = new AgentProfileService({
    profiles: stored,
    connections,
    authorization,
    groups,
    operations: new AgentOperationRegistry(),
    simulation: { isActive: false, scenario: "ok" },
  });
  const pins = new AgentPlanConfigurationPins(
    { profiles },
    { requireProfiles: async () => undefined },
  );
  return { connection, connections, profiles, pins };
}

it.each(["openrouter", "zai"] as const)(
  "offers %s's own catalog and saves/resolves an independent coding node in both modes",
  async (provider) => {
    const { profiles, pins } = world(provider);
    const models = await profiles.planModels("admin");
    expect(models).toHaveLength(1);
    const model = models[0];
    if (!model) throw new Error("Missing fixture model");
    expect(model).toMatchObject({
      provider,
      connectionId: "selected",
      model: "deepseek/deepseek-v4.1-flash",
    });
    for (const access of ["read_only", "yolo"] as const) {
      const base = planConfigurationForModel(model);
      const configuration = {
        ...base,
        reasoningEffort: "low",
        template: { ...base.template, run: acpRunOptions(access, 0) },
      };
      const node = {
        id: "node",
        type: "agent" as const,
        agentId: "",
        personalAgentId: null,
        instruction: "",
        bindings: {},
        x: 0,
        y: 0,
        configuration,
      };
      const plan = { ...emptyAgentPlan(), projectId: undefined, nodes: [node] };
      expect(
        isAgentRunOptionsAllowed(
          provider,
          configuration.template.run,
          undefined,
        ),
      ).toBe(true);
      await expect(pins.pin("admin", plan, null)).resolves.toMatchObject({
        nodes: [{ configuration }],
      });
      await expect(
        profiles.resolveDefinition("admin", {
          agentId: "",
          personalAgentId: null,
          projectId: null,
          configuration,
        }),
      ).resolves.toMatchObject({
        assignment: {
          connection: { provider, id: "selected" },
          model: "deepseek/deepseek-v4.1-flash",
          reasoningEffort: "low",
        },
      });
    }
  },
);

it("refuses stale OpenCode foreign models even before a catalog refresh", async () => {
  const { connections } = world("opencode");
  const selection = {
    connectionId: "selected",
    model: "openrouter/deepseek/deepseek-v4.1-flash",
    reasoningEffort: null,
  };
  vi.mocked(connections.catalogs().find).mockResolvedValue({
    ...emptyModelCatalog(),
    models: [{ ...ZEN, id: selection.model }],
  });
  await expect(
    resolveAgentAssignmentFor(
      connections,
      { actor: ACTOR, groupIds: [] },
      selection,
    ),
  ).rejects.toMatchObject({ code: "modelUnavailable" });
});

it.each(["openrouter", "zai"] as const)(
  "reads and redacts only the selected %s key, and refuses unverified or inactive access",
  async (provider) => {
    const { connection, connections } = world(provider);
    const cipher = new InstanceSecretCipher(Buffer.alloc(32, 7));
    const key = "synthetic-private-selected-411";
    const secret = vi
      .spyOn(connections, "findSecretEncrypted")
      .mockResolvedValue(cipher.encrypt(connection.id, key));
    const credentials = new OpenCodeAgentCredentials(connections, cipher);
    const access = await credentials.read(connection);
    expect(secret).toHaveBeenCalledExactlyOnceWith("selected");
    expect(access.environmentFor(provider)).toEqual({
      OPENCODE_AUTH_CONTENT: JSON.stringify({
        [provider]: { type: "api", key },
      }),
    });
    expect(
      access.environmentFor(provider === "zai" ? "openrouter" : "zai"),
    ).toEqual({});
    expect(access.redact(`diagnostic ${key}`)).toBe("diagnostic [redacted]");
    secret.mockClear();
    vi.mocked(connections.checks().find).mockResolvedValue(null);
    await expect(credentials.read(connection)).rejects.toMatchObject({
      code: "provider_auth_failed",
    });
    expect(secret).not.toHaveBeenCalled();
    vi.mocked(connections.find).mockResolvedValue({
      ...connection,
      isActive: false,
    });
    await expect(credentials.read(connection)).rejects.toMatchObject({
      code: "plan_model_unavailable",
    });
    expect(secret).not.toHaveBeenCalled();
  },
);
