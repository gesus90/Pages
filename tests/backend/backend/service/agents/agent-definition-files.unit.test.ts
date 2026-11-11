import { beforeEach, expect, it, vi } from "vitest";

import { AgentDefinitionFiles } from "@/backend/service/agents/AgentDefinitionFiles";

import { memoryFiles } from "./page-agent-files";
import { AGENTS_DIRECTORY, PageAgentWorld } from "./page-agent-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

beforeEach(() => memoryFiles.reset());

it("repairs a changed definition after the final hold is released", async () => {
  const world = new PageAgentWorld();
  world.addModel("model");
  const file = `${AGENTS_DIRECTORY}/model/AGENT.md`;
  const release = await world.files.hold(["model"]);
  const secondRelease = await world.files.hold(["model"]);
  memoryFiles.tamper(file, "changed");
  await release();
  expect(memoryFiles.read(file)).toBe("changed");
  await secondRelease();
  expect(await world.files.read("model")).toMatchObject({
    agentId: "model",
    revision: 1,
  });
  const writes = memoryFiles.writes.length;
  await secondRelease();
  expect(memoryFiles.writes).toHaveLength(writes);
});

it("rejects missing, malformed, mismatched and invalid definitions", async () => {
  const files = new AgentDefinitionFiles(AGENTS_DIRECTORY);
  const file = `${AGENTS_DIRECTORY}/model/AGENT.md`;
  await expect(files.read("model")).rejects.toMatchObject({
    code: "plan_definition_changed",
  });
  for (const content of [
    "no definition",
    "## Definition\n\n```json\n{\n```",
    '## Definition\n\n```json\n{"agentId":"other","revision":1}\n```',
    '## Definition\n\n```json\n{"agentId":"model","revision":1.5}\n```',
  ]) {
    memoryFiles.tamper(file, content);
    await expect(files.read("model")).rejects.toMatchObject({
      code: "plan_definition_changed",
    });
  }
});

it("keeps a hold mutable only after release and tolerates failed repair writes", async () => {
  const world = new PageAgentWorld();
  world.addModel("model");
  const release = await world.files.hold(["model"]);
  expect(() => world.files.assertMutable("model")).toThrow();
  memoryFiles.failWrites();
  await expect(release()).resolves.toBeUndefined();
  expect(() => world.files.assertMutable("model")).not.toThrow();
});
