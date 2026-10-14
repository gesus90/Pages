import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  DEFAULT_AGENT_RUN_OPTIONS,
  DEFAULT_ACP_RUN_OPTIONS,
  acpRunOptions,
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
  world.addModel("opencode", { provider: "opencode", efforts: ["high"] });
});

/** The ACP runners: the model of each and the code that asks for a mode. */
const ACP_RUNNERS = [
  {
    model: "codex",
    provider: "codex_cli",
    modeRequired: "codex_permission_mode_required",
  },
  {
    model: "claude",
    provider: "claude_code",
    modeRequired: "claude_permission_mode_required",
  },
] as const;

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

it.each(ACP_RUNNERS)(
  "stores the chosen $provider mode and shows it unchanged when the agent list opens the agent again",
  async ({ model, provider }) => {
    const id = await saveFromList(model, acpRunOptions("yolo", 15));
    const page = await world.agents.page("owner");
    const agent = page.agents.find((entry) => entry.id === id);
    expect(agent?.provider).toBe(provider);
    expect(agent?.configuration.run).toEqual(acpRunOptions("yolo", 15));
    expect(page.models.find((entry) => entry.id === model)?.provider).toBe(
      provider,
    );
    await saveFromList(model, acpRunOptions("read_only", 15), id);
    const reopened = (await world.agents.page("owner")).agents.find(
      (entry) => entry.id === id,
    );
    expect(reopened?.configuration.run).toEqual(acpRunOptions("read_only", 15));
  },
);

it.each(ACP_RUNNERS)(
  "refuses to store the earlier write mode for a new $provider agent",
  async ({ model, modeRequired }) => {
    await expect(
      saveFromList(model, DEFAULT_AGENT_RUN_OPTIONS),
    ).rejects.toEqual(new AgentError(modeRequired));
    expect(world.storedAgents()).toEqual([]);
  },
);

it.each(ACP_RUNNERS)(
  "keeps an earlier write mode unchanged when another field of an existing $provider agent changes, and never makes it YOLO",
  async ({ model }) => {
    world.seedAgent({
      id: "legacy",
      ownerId: "owner",
      modelProfileId: model,
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
  },
);

it.each(ACP_RUNNERS)(
  "gives a $provider agent created over MCP the read-only mode, which MCP shows and cannot change",
  async ({ model }) => {
    const created = (await world.call("owner", "agents.create", {
      operationId: "create-acp",
      name: "Reviewer",
      modelProfileId: model,
      reasoningEffort: "high",
    })) as { readonly id: string };
    expect(world.storedAgents()[0]?.configuration?.run).toEqual(
      DEFAULT_ACP_RUN_OPTIONS,
    );
    expect(
      await world.call("owner", "agents.read", { agentId: created.id }),
    ).toMatchObject({ agent: { run: DEFAULT_ACP_RUN_OPTIONS } });
  },
);

it("offers YOLO to no runner without ACP", async () => {
  await expect(
    saveFromList("opencode", acpRunOptions("yolo", 0)),
  ).rejects.toEqual(new AgentError("plan_run_option_unsupported"));
  const id = await saveFromList("opencode", DEFAULT_AGENT_RUN_OPTIONS);
  expect(
    world.storedAgents().find((entry) => entry.id === id)?.configuration?.run,
  ).toEqual(DEFAULT_AGENT_RUN_OPTIONS);
});
