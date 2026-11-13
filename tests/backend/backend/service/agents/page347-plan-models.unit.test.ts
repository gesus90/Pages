import { expect, it, vi } from "vitest";

import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentPlanConfigurationPins } from "@/backend/service/agents/AgentPlanConfigurationPins";
import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";
import { emptyAgentPlan } from "@/definition/AgentPlan";
import { planConfigurationForModel } from "@/definition/AgentPlanConfiguration";

import { bareInstance } from "../tasks/bare-instance";
import { ACTOR, modelWorld, ZEN } from "../employee/page347-model-fixture";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";

function planWorld(): {
  readonly profiles: AgentProfileService;
  readonly connections: AgentConnectionRepository;
  readonly pins: AgentPlanConfigurationPins;
} {
  const { connections } = modelWorld();
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
    authorization,
    groups,
    connections,
    operations: new AgentOperationRegistry(),
    simulation: { isActive: false, scenario: "ok" },
  });
  const pins = new AgentPlanConfigurationPins(
    { profiles },
    { requireProfiles: async () => undefined },
  );
  return { profiles, pins, connections };
}

it("keeps incompatible models and every configured provider in the plan catalog", async () => {
  const { profiles, connections } = planWorld();
  vi.spyOn(connections.catalogs(), "find").mockResolvedValue({
    ...emptyModelCatalog(),
    models: [ZEN, { ...ZEN, id: "no-tools", isToolCapable: false }],
  });
  const listed = await profiles.planModels("admin");
  expect(listed.map((model) => [model.provider, model.model])).toEqual([
    ["opencode", ZEN.id],
    ["opencode", "no-tools"],
    ["openai", ZEN.id],
    ["openai", "no-tools"],
  ]);
});

it.each([true, false])(
  "checks tool capability %s at plan save and start using the same rule",
  async (isToolCapable) => {
    const { profiles, pins, connections } = planWorld();
    vi.spyOn(connections.catalogs(), "find").mockResolvedValue({
      ...emptyModelCatalog(),
      models: [{ ...ZEN, isToolCapable }],
    });
    const model = (await profiles.planModels("admin"))[0];
    if (!model) throw new Error("Missing synthetic plan model");
    const configuration = planConfigurationForModel(model);
    const plan = {
      ...emptyAgentPlan(),
      projectId: undefined,
      nodes: [
        {
          id: "agent",
          type: "agent" as const,
          agentId: "agent",
          personalAgentId: null,
          instruction: "",
          bindings: {},
          x: 0,
          y: 0,
          configuration,
        },
      ],
    };
    const selection = {
      agentId: "agent",
      personalAgentId: null,
      projectId: null,
      configuration,
    };
    if (isToolCapable) {
      await expect(pins.pin("admin", plan, null)).resolves.toMatchObject({
        nodes: [{ configuration }],
      });
      await expect(
        profiles.resolveDefinition("admin", selection),
      ).resolves.toMatchObject({ assignment: { model: ZEN.id } });
    } else {
      await expect(pins.pin("admin", plan, null)).rejects.toMatchObject({
        code: "provider_model_not_found",
      });
      await expect(
        profiles.resolveDefinition("admin", selection),
      ).rejects.toMatchObject({ code: "provider_model_not_found" });
    }
  },
);
