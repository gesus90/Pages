import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  DEFAULT_AGENT_RUN_OPTIONS,
  DEFAULT_CODEX_RUN_OPTIONS,
  codexRunOptions,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";

import { memoryFiles } from "./page-agent-files";
import { PageAgentWorld } from "./page-agent-world";

import type { AgentRunOptions } from "@/definition/AgentConfiguration";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

let world = new PageAgentWorld();

beforeEach(() => {
  memoryFiles.reset();
  world = new PageAgentWorld();
  world.addPerson("owner");
  world.addModel("codex", { provider: "codex_cli", efforts: ["high"] });
  world.addModel("claude", { provider: "claude_code", efforts: ["high"] });
});

/** Saves an agent the way the agent list form does. */
async function saveFromList(
  modelProfileId: string,
  run: AgentRunOptions,
  id: string | null = null,
): Promise<string> {
  const revision = world
    .storedAgents()
    .find((entry) => entry.id === id)?.revision;
  return world.agents.save("owner", id, {
    name: "Reviewer",
    modelProfileId,
    reasoningEffort: "high",
    configuration: { ...emptyAgentConfiguration(), accessMode: "shared", run },
    ...(revision === undefined ? {} : { revision }),
  });
}

it("stores the chosen Codex mode and shows it unchanged when the agent list opens the agent again", async () => {
  const id = await saveFromList("codex", codexRunOptions("yolo", 15));
  const page = await world.agents.page("owner");
  const agent = page.agents.find((entry) => entry.id === id);
  expect(agent?.provider).toBe("codex_cli");
  expect(agent?.configuration.run).toEqual(codexRunOptions("yolo", 15));
  expect(page.models.find((model) => model.id === "codex")?.provider).toBe(
    "codex_cli",
  );
  await saveFromList("codex", codexRunOptions("read_only", 15), id);
  const reopened = (await world.agents.page("owner")).agents.find(
    (entry) => entry.id === id,
  );
  expect(reopened?.configuration.run).toEqual(codexRunOptions("read_only", 15));
});

it("refuses to store the earlier write mode for a new Codex agent", async () => {
  await expect(
    saveFromList("codex", DEFAULT_AGENT_RUN_OPTIONS),
  ).rejects.toEqual(new AgentError("codex_permission_mode_required"));
  expect(world.storedAgents()).toEqual([]);
});

it("keeps an earlier write mode unchanged when another field of an existing Codex agent changes, and never makes it YOLO", async () => {
  world.seedAgent({
    id: "legacy",
    ownerId: "owner",
    modelProfileId: "codex",
    reasoningEffort: "high",
  });
  expect(world.storedAgents()[0]?.configuration?.run).toEqual(
    DEFAULT_AGENT_RUN_OPTIONS,
  );
  await world.call("owner", "agents.update", {
    operationId: "rename-legacy",
    agentId: "legacy",
    expectedRevision: 1,
    name: "Renamed",
  });
  expect(world.storedAgents()[0]).toMatchObject({
    name: "Renamed",
    configuration: { run: DEFAULT_AGENT_RUN_OPTIONS },
  });
});

it("gives a Codex agent created over MCP the read-only mode, which MCP shows and cannot change", async () => {
  const created = (await world.call("owner", "agents.create", {
    operationId: "create-codex",
    name: "Reviewer",
    modelProfileId: "codex",
    reasoningEffort: "high",
  })) as { readonly id: string };
  expect(world.storedAgents()[0]?.configuration?.run).toEqual(
    DEFAULT_CODEX_RUN_OPTIONS,
  );
  expect(
    await world.call("owner", "agents.read", { agentId: created.id }),
  ).toMatchObject({ agent: { run: DEFAULT_CODEX_RUN_OPTIONS } });
});

it("offers YOLO to no other runner", async () => {
  await expect(
    saveFromList("claude", codexRunOptions("yolo", 0)),
  ).rejects.toEqual(new AgentError("plan_run_option_unsupported"));
  const id = await saveFromList("claude", DEFAULT_AGENT_RUN_OPTIONS);
  expect(
    world.storedAgents().find((entry) => entry.id === id)?.configuration?.run,
  ).toEqual(DEFAULT_AGENT_RUN_OPTIONS);
});
