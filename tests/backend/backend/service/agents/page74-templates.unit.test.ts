import { beforeEach, expect, it, vi } from "vitest";

import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { applyPlanChanges } from "@/backend/service/agents/AgentPlanStructureChanges";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import { memoryFiles } from "./page-agent-files";
import { templateFixture, templateInput } from "./page74-template-fixture";

vi.mock("node:fs/promises", async () =>
  (await import("./page-agent-files")).memoryFilesModule(),
);

beforeEach(() => memoryFiles.reset());

it("saves a held template while retaining ownership, revision and deletion checks", async () => {
  const { world, agentId } = await templateFixture();
  const release = await world.files.hold([agentId]);
  const previous = world.storedAgents()[0];
  const changed = {
    ...templateInput(),
    revision: previous.revision,
    configuration: { ...templateInput().configuration, markdown: "Z" },
  };
  await expect(
    world.agents.save("other", agentId, changed),
  ).rejects.toMatchObject({ code: "agent_usage_denied" });
  await world.agents.save("owner", agentId, changed);
  expect((await world.files.read(agentId)).configuration.markdown).toBe("Z");
  await expect(
    world.agents.save("owner", agentId, changed),
  ).rejects.toMatchObject({ code: "profile_conflict" });
  await expect(world.agents.remove("owner", agentId)).rejects.toMatchObject({
    code: "profile_running",
  });
  await release();
  expect(world.storedAgents()[0].revision).toBe(2);
});

it("pins each inserted node, persists all runtime fields, and reinserts the current template", async () => {
  const { world, agentId, plan } = await templateFixture();
  const catalog = await world.administration.catalog("owner");
  const source = catalog.find((entry) => entry.id === agentId);
  if (!source) throw new Error("Missing template");
  const added = applyPlanChanges(
    plan,
    [{ action: "addNode", id: "second", type: "agent", fields: { agentId } }],
    { agents: catalog },
  ).plan;
  const first = added.nodes.find((entry) => entry.id === "node");
  const second = added.nodes.find((entry) => entry.id === "second");
  if (
    first?.type !== "agent" ||
    second?.type !== "agent" ||
    !first.configuration ||
    !second.configuration
  )
    throw new Error("Missing nodes");
  expect(first.configuration).toEqual(second.configuration);
  expect(first.configuration.template.parameters).not.toBe(
    second.configuration.template.parameters,
  );
  const edited = {
    ...first,
    configuration: {
      ...first.configuration,
      modelProfileId: "model-b",
      model: "model-model-b",
      reasoningEffort: "high",
      template: { ...first.configuration.template, markdown: "Y {{count}}" },
    },
  };
  const saved = readPlanInput(
    JSON.parse(
      JSON.stringify({
        ...added,
        nodes: added.nodes.map((node) =>
          node.id === edited.id ? edited : node,
        ),
      }),
    ) as unknown,
  );
  expect(saved.nodes.find((entry) => entry.id === "node")).toEqual(edited);
  expect(second.configuration.template.markdown).toBe("X {{count}}");
  expect(world.storedAgents()[0].configuration?.markdown).toBe("X {{count}}");
  await world.agents.save("owner", agentId, {
    ...templateInput(),
    revision: 1,
    configuration: {
      ...templateInput().configuration,
      markdown: "Z {{count}}",
    },
  });
  const current = (await world.administration.catalog("owner")).find(
    (entry) => entry.id === agentId,
  );
  if (!current) throw new Error("Missing current template");
  expect(copyPlanConfiguration(current).template.markdown).toBe("Z {{count}}");
  expect(first.configuration.template.markdown).toBe("X {{count}}");
  expect(edited.configuration.template.markdown).toBe("Y {{count}}");
  expect(copyPlanConfiguration(current).modelProfileId).toBe("model-a");
});

it("authorizes the node's chosen model independently of later template model and instruction changes", async () => {
  const { world, agentId, plan } = await templateFixture();
  const node = plan.nodes.find((entry) => entry.type === "agent");
  if (node?.type !== "agent" || !node.configuration)
    throw new Error("Missing node");
  const configuration = {
    ...node.configuration,
    modelProfileId: "model-b",
    model: "model-model-b",
    reasoningEffort: "high",
  };
  await world.agents.save("owner", agentId, {
    ...templateInput(),
    revision: 1,
    configuration: { ...templateInput().configuration, markdown: "Changed" },
  });
  const selection = {
    agentId,
    personalAgentId: null,
    projectId: null,
    configuration,
  };
  const resolved = await world.administration.resolveDefinition(
    "owner",
    selection,
  );
  expect(resolved.assignment).toMatchObject({
    model: "model-model-b",
    reasoningEffort: "high",
  });
  await expect(
    world.administration.resolveDefinition("other", selection),
  ).rejects.toMatchObject({ code: "agent_usage_denied" });
  await expect(
    world.administration.resolveDefinition("owner", {
      ...selection,
      configuration: { ...configuration, reasoningEffort: "unknown" },
    }),
  ).rejects.toMatchObject({ code: "reasoningUnsupported" });
  await expect(
    world.administration.resolveDefinition("owner", {
      ...selection,
      configuration: { ...configuration, model: "unreleased" },
    }),
  ).rejects.toMatchObject({ code: "agent_usage_denied" });
  world.withdrawModel("model-b");
  await expect(
    world.administration.resolveDefinition("owner", selection),
  ).rejects.toMatchObject({ code: "agent_usage_denied" });
});

it("copies the newly assigned template when an API update repairs an agent node", async () => {
  const { world, plan } = await templateFixture();
  const replacementId = await world.agents.save("owner", null, {
    ...templateInput(),
    name: "Template B",
    modelProfileId: "model-b",
  });
  const catalog = await world.administration.catalog("owner");
  const changed = applyPlanChanges(
    plan,
    [
      {
        action: "updateNode",
        nodeId: "node",
        fields: { agentId: replacementId },
      },
    ],
    { agents: catalog },
  ).plan;
  expect(changed.nodes.find((node) => node.id === "node")).toMatchObject({
    configuration: {
      name: "Template B",
      modelProfileId: "model-b",
      model: "model-model-b",
      template: { markdown: "X {{count}}" },
    },
  });
});

it("keeps automatic personal model access unambiguous and rechecks the person's grant", async () => {
  const { world, agentId, plan } = await templateFixture();
  world.addModel("personal", {
    model: "model-model-a",
    efforts: ["low", "high"],
    targets: [{ kind: "person", targetId: "owner" }],
  });
  const node = plan.nodes.find((entry) => entry.type === "agent");
  if (node?.type !== "agent" || !node.configuration)
    throw new Error("Missing node");
  const selection = {
    agentId,
    personalAgentId: null,
    projectId: null,
    configuration: { ...node.configuration, modelProfileId: "" },
  };
  expect(
    (await world.administration.resolveDefinition("owner", selection))
      .accessAgentId,
  ).toBe("personal");
  world.addModel("second-personal", {
    model: "model-model-a",
    efforts: ["low", "high"],
    targets: [{ kind: "person", targetId: "owner" }],
  });
  await expect(
    world.administration.resolveDefinition("owner", selection),
  ).rejects.toMatchObject({ code: "personal_access_selection_required" });
  expect(
    (
      await world.administration.resolveDefinition("owner", {
        ...selection,
        configuration: {
          ...selection.configuration,
          modelProfileId: "personal",
        },
      })
    ).accessAgentId,
  ).toBe("personal");
  world.withdrawModel("personal");
  world.withdrawModel("second-personal");
  await expect(
    world.administration.resolveDefinition("owner", selection),
  ).rejects.toMatchObject({ code: "personal_access_missing" });
});
