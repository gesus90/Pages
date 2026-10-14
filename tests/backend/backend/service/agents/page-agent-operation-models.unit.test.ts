import { beforeEach, expect, it, vi } from "vitest";

import { memoryFiles } from "./page-agent-files";
import { PageAgentWorld } from "./page-agent-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

interface ModelEntry {
  readonly modelProfileId: string;
  readonly name: string;
  readonly model: string;
  readonly reasoning: string;
  readonly reasoningEfforts: readonly string[];
  readonly catalogDefaultReasoningEffort: string | null;
  readonly defaultReasoningEffort: string | null;
  readonly isDefault: boolean;
}

interface Changed {
  readonly id: string;
  readonly changed: boolean;
  readonly revision: number;
}

let world = new PageAgentWorld();

beforeEach(() => {
  memoryFiles.reset();
  world = new PageAgentWorld();
  world.addPerson("owner");
  world.addPerson("other");
});

async function models(userId: string): Promise<readonly ModelEntry[]> {
  const result = (await world.call(userId, "agents.models.list")) as {
    models: readonly ModelEntry[];
  };
  return result.models;
}

async function agentOf(userId: string, id: string): Promise<unknown> {
  const result = (await world.call(userId, "agents.read", { agentId: id })) as {
    agent: unknown;
  };
  return result.agent;
}

it("lists only models that were released for the person and verify now", async () => {
  world.addModel("everyone");
  world.addModel("personal-other", {
    targets: [{ kind: "person", targetId: "other" }],
  });
  world.addModel("personal-owner", {
    targets: [{ kind: "person", targetId: "owner" }],
  });
  world.addModel("inactive", { isActive: false });
  world.addModel("unverified", { isVerified: false });
  world.addModel("closed-connection", {
    scope: {
      mode: "restricted",
      targets: [{ kind: "person", targetId: "other" }],
    },
  });

  const ownerModels = await models("owner");
  const otherModels = await models("other");

  expect(ownerModels.map((entry) => entry.modelProfileId).sort()).toEqual([
    "everyone",
    "personal-owner",
  ]);
  expect(otherModels.map((entry) => entry.modelProfileId).sort()).toEqual([
    "closed-connection",
    "everyone",
    "personal-other",
  ]);
});

it("returns neither credentials nor connection details", async () => {
  world.addModel("open", { efforts: ["low", "high"] });

  const [entry] = await models("owner");

  expect(Object.keys(entry).sort()).toEqual([
    "catalogDefaultReasoningEffort",
    "defaultReasoningEffort",
    "isDefault",
    "model",
    "modelProfileId",
    "name",
    "reasoning",
    "reasoningEfforts",
  ]);
  expect(JSON.stringify(entry)).not.toMatch(/connection|secret|key|token/iu);
});

it("reports the levels the catalog lists and what it names as default", async () => {
  world.addModel("open", {
    efforts: ["low", "medium", "high"],
    catalogDefault: "low",
  });

  const [entry] = await models("owner");

  expect(entry).toMatchObject({
    reasoning: "levels",
    reasoningEfforts: ["low", "medium", "high"],
    catalogDefaultReasoningEffort: "low",
    defaultReasoningEffort: "medium",
  });
});

it("falls back to the catalog default only when medium is not listed", async () => {
  world.addModel("high-only", {
    efforts: ["low", "high"],
    catalogDefault: "high",
  });

  const [entry] = await models("owner");

  expect(entry.defaultReasoningEffort).toBe("high");
});

it("has no default effort for a model that lists levels without medium or a default", async () => {
  world.addModel("bare", { efforts: ["low", "high"] });

  const [entry] = await models("owner");

  expect(entry.defaultReasoningEffort).toBeNull();
});

it("has no effort at all for a model without levels, and ignores a stray catalog default", async () => {
  world.addModel("plain", { catalogDefault: "medium", reasoning: "automatic" });

  const [entry] = await models("owner");

  expect(entry).toMatchObject({
    reasoning: "automatic",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
  });
});

it("marks the first listed model as the default one", async () => {
  world.addModel("z-model", { name: "Zeta" });
  world.addModel("a-model", { name: "Alpha" });

  const entries = await models("owner");

  expect(entries.map((entry) => [entry.name, entry.isDefault])).toEqual([
    ["Alpha", true],
    ["Zeta", false],
  ]);
});

it("applies the default model and medium when a create names neither", async () => {
  world.addModel("z-model", { name: "Zeta", efforts: ["low", "medium"] });
  world.addModel("a-model", { name: "Alpha", efforts: ["low", "medium"] });

  const created = (await world.call("owner", "agents.create", {
    operationId: "create-1",
    name: "Reviewer",
  })) as Changed;

  expect(await agentOf("owner", created.id)).toMatchObject({
    modelProfileId: "a-model",
    reasoningEffort: "medium",
  });
});

it("applies the catalog default when the default model does not list medium", async () => {
  world.addModel("only", { efforts: ["low", "high"], catalogDefault: "low" });

  const created = (await world.call("owner", "agents.create", {
    operationId: "create-1",
    name: "Reviewer",
  })) as Changed;

  expect(await agentOf("owner", created.id)).toMatchObject({
    reasoningEffort: "low",
  });
});

it("refuses a create without a usable default model, with a documented reason", async () => {
  world.addModel("personal-other", {
    targets: [{ kind: "person", targetId: "other" }],
  });

  await expect(
    world.call("owner", "agents.create", {
      operationId: "create-1",
      name: "Reviewer",
    }),
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
    details: { reason: "default_model_unavailable" },
  });
  expect(world.storedAgents()).toEqual([]);
  expect(world.keys.size).toBe(0);
});

it("asks for a level when the model lists levels and none can be applied", async () => {
  world.addModel("bare", { efforts: ["low", "high"] });

  await expect(
    world.call("owner", "agents.create", {
      operationId: "create-1",
      name: "Reviewer",
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "reasoning_required" },
  });
  expect(world.storedAgents()).toEqual([]);
});

it("accepts high only when the model supports it", async () => {
  world.addModel("with-high", { efforts: ["medium", "high"] });
  world.addModel("without-high", { efforts: ["low", "medium"] });

  const accepted = (await world.call("owner", "agents.create", {
    operationId: "create-1",
    name: "Deep",
    modelProfileId: "with-high",
    reasoningEffort: "high",
  })) as Changed;

  expect(await agentOf("owner", accepted.id)).toMatchObject({
    reasoningEffort: "high",
  });
  await expect(
    world.call("owner", "agents.create", {
      operationId: "create-2",
      name: "Deep",
      modelProfileId: "without-high",
      reasoningEffort: "high",
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "reasoning_unsupported" },
  });
  expect(world.storedAgents()).toHaveLength(1);
});

it("refuses a level for a model without levels and no level for one that lists them", async () => {
  world.addModel("plain");
  world.addModel("levels", { efforts: ["low", "medium"] });

  await expect(
    world.call("owner", "agents.create", {
      operationId: "create-1",
      name: "A",
      modelProfileId: "plain",
      reasoningEffort: "medium",
    }),
  ).rejects.toMatchObject({ details: { reason: "reasoning_unsupported" } });
  await expect(
    world.call("owner", "agents.create", {
      operationId: "create-2",
      name: "B",
      modelProfileId: "levels",
      reasoningEffort: null,
    }),
  ).rejects.toMatchObject({ details: { reason: "reasoning_unsupported" } });
});

it("refuses a model that is not released for the person without telling why", async () => {
  world.addModel("everyone");
  world.addModel("personal-other", {
    targets: [{ kind: "person", targetId: "other" }],
  });

  await expect(
    world.call("owner", "agents.create", {
      operationId: "create-1",
      name: "A",
      modelProfileId: "personal-other",
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "model_unavailable" },
  });
  await expect(
    world.call("owner", "agents.create", {
      operationId: "create-2",
      name: "A",
      modelProfileId: "no-such-model",
    }),
  ).rejects.toMatchObject({ details: { reason: "model_unavailable" } });
});

it("validates the model again when an agent is changed", async () => {
  world.addModel("everyone", { efforts: ["medium"] });
  const created = (await world.call("owner", "agents.create", {
    operationId: "create-1",
    name: "Reviewer",
  })) as Changed;

  world.setVerified("everyone", false);

  await expect(
    world.call("owner", "agents.update", {
      operationId: "rename-1",
      agentId: created.id,
      expectedRevision: 1,
      name: "Renamed",
    }),
  ).rejects.toMatchObject({ details: { reason: "model_unavailable" } });
  expect(await agentOf("owner", created.id)).toMatchObject({
    name: "Reviewer",
    revision: 1,
  });
});
