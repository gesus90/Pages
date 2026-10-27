import { beforeEach, expect, it, vi } from "vitest";

import { memoryFiles } from "./page-agent-files";
import { PageAgentWorld } from "./page-agent-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

interface ModelEntry {
  readonly modelProfileId: string;
  readonly connectionId: string;
  readonly provider: string;
  readonly name: string;
  readonly model: string;
  readonly reasoning: string;
  readonly reasoningEfforts: readonly string[];
  readonly catalogDefaultReasoningEffort: string | null;
  readonly defaultReasoningEffort: string | null;
  readonly isDefault: boolean;
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

/** The connections that offer a model; each test connection offers one model. */
function connectionsOf(entries: readonly ModelEntry[]): readonly string[] {
  return entries.map((entry) => entry.connectionId).sort();
}

it("lists only models of connections that admit the person, are active and verify now", async () => {
  world.addModel("everyone");
  world.addModel("also-everyone", {
    targets: [{ kind: "person", targetId: "other" }],
  });
  world.addModel("inactive", { isActive: false });
  world.addModel("unverified", { isVerified: false });
  world.addModel("closed-connection", {
    scope: {
      mode: "restricted",
      targets: [{ kind: "person", targetId: "other" }],
    },
  });

  expect(connectionsOf(await models("owner"))).toEqual([
    "connection-also-everyone",
    "connection-everyone",
  ]);
  expect(connectionsOf(await models("other"))).toEqual([
    "connection-also-everyone",
    "connection-closed-connection",
    "connection-everyone",
  ]);
});

it("returns neither credentials nor connection details beyond the connection identifier and provider", async () => {
  world.addModel("open", { efforts: ["low", "high"] });

  const [entry] = await models("owner");

  expect(Object.keys(entry).sort()).toEqual([
    "catalogDefaultReasoningEffort",
    "connectionId",
    "defaultReasoningEffort",
    "isDefault",
    "model",
    "modelProfileId",
    "name",
    "provider",
    "reasoning",
    "reasoningEfforts",
  ]);
  expect(JSON.stringify(entry)).not.toMatch(/secret|apiKey|token/iu);
});

it("reports the levels and the default the catalog names, and picks no default of its own", async () => {
  world.addModel("open", {
    efforts: ["low", "medium", "high"],
    catalogDefault: "low",
  });

  const [entry] = await models("owner");

  expect(entry).toMatchObject({
    reasoning: "levels",
    reasoningEfforts: ["low", "medium", "high"],
    catalogDefaultReasoningEffort: "low",
    defaultReasoningEffort: null,
  });
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

it("marks no model as the default one, because the model belongs to the plan node", async () => {
  world.addModel("z-model", { name: "Zeta" });
  world.addModel("a-model", { name: "Alpha" });

  const entries = await models("owner");

  expect(entries).toHaveLength(2);
  expect(entries.every((entry) => !entry.isDefault)).toBe(true);
});

it("passes the model identifier as the identifier of the connection and the model", async () => {
  world.addModel("open");

  const [entry] = await models("owner");

  expect(entry).toMatchObject({
    modelProfileId: JSON.stringify(["connection-open", "model-open"]),
    provider: "openrouter",
  });
});
