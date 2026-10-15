import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { upgradePlanConfigurations } from "@/backend/service/agents/AgentPlanConfigurationUpgrade";

import { memoryFiles } from "./page-agent-files";
import { PlanDatabase } from "./page61-plan-database";
import { templateFixture, templateInput } from "./page74-template-fixture";

vi.mock("node:fs/promises", async () =>
  (await import("./page-agent-files")).memoryFilesModule(),
);
beforeEach(() => memoryFiles.reset());

it("pins legacy nodes exactly once, persists independent configuration, and rejects a competing revision", async () => {
  const { world, plan, agentId } = await templateFixture();
  const database = new PlanDatabase();
  database.agents.add(agentId);
  const legacy = {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.type !== "agent") return node;
      const { configuration, ...fields } = node;
      expect(configuration).toBeDefined();
      return fields;
    }),
  };
  database.insert(legacy);
  const plans = new AgentPlanRepository(database.asDatabase());
  const upgrade = {
    plans,
    profiles: { list: async () => world.stored() },
    connections: { find: async (id: string) => world.facts(id).connection },
  };
  await upgradePlanConfigurations(upgrade);
  const opened = await plans.find(plan.id);
  expect(opened?.revision).toBe(2);
  expect(opened?.nodes.find((node) => node.type === "agent")).toMatchObject({
    configuration: {
      modelProfileId: "model-a",
      template: {
        markdown: "X {{count}}",
        parameters: [{ name: "count" }],
        run: { timeoutMinutes: 0 },
      },
    },
  });
  await world.agents.save("owner", agentId, {
    ...templateInput(),
    revision: 1,
    configuration: {
      ...templateInput().configuration,
      markdown: "Later template {{count}}",
    },
  });
  await upgradePlanConfigurations(upgrade);
  expect(await plans.find(plan.id)).toEqual(opened);
  if (!opened) throw new Error("Missing pinned plan");
  const node = opened.nodes.find((entry) => entry.type === "agent");
  if (node?.type !== "agent" || !node.configuration)
    throw new Error("Missing pinned node");
  const edited = {
    ...node,
    configuration: {
      ...node.configuration,
      template: {
        ...node.configuration.template,
        markdown: "Node edit {{count}}",
      },
    },
  };
  await plans.save(
    {
      ...opened,
      nodes: opened.nodes.map((entry) =>
        entry.id === node.id ? edited : entry,
      ),
    },
    false,
  );
  await expect(plans.save(opened, false)).rejects.toMatchObject({
    code: "plan_conflict",
  });
  const reopened = await plans.find(plan.id);
  expect(reopened?.revision).toBe(3);
  expect(reopened?.nodes.find((entry) => entry.id === node.id)).toEqual(edited);
  expect(world.storedAgents()[0].configuration?.markdown).toBe(
    "Later template {{count}}",
  );
});
