import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { memoryFiles } from "./page-agent-files";
import { PageAgentWorld } from "./page-agent-world";

import type { AgentParameter } from "@/definition/AgentParameters";
import type { PageAgentInput } from "@/definition/PageAgent";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

const resolve = vi.fn(async () => ({
  markdown: "Synthetic ticket",
  version: "1",
}));
let world: PageAgentWorld;

beforeEach(() => {
  memoryFiles.reset();
  resolve.mockClear();
  world = new PageAgentWorld({ choices: async () => [], resolve });
  world.addPerson("owner");
  world.addPerson("other");
  world.addPerson("admin", { isAdmin: true });
  world.addModel("model");
});

function input(parameters: readonly AgentParameter[] = []): PageAgentInput {
  return {
    name: "Synthetic agent",
    modelProfileId: "model",
    reasoningEffort: null,
    configuration: {
      ...emptyAgentConfiguration(),
      accessMode: "shared",
      parameters,
    },
  };
}

it("persists string, numeric and ticket parameters and deletes every type on replacement", async () => {
  const parameters: readonly AgentParameter[] = [
    {
      name: "message",
      type: "text",
      description: "String",
      isRequired: true,
      defaultValue: { type: "text", text: "Full string" },
    },
    {
      name: "amount",
      type: "number",
      description: "Number",
      isRequired: true,
      defaultValue: { type: "number", number: -12.5 },
    },
    {
      name: "ticketID",
      type: "ticket",
      description: "Ticket",
      isRequired: true,
      defaultValue: { type: "ticket", ticketId: "ticket-id" },
    },
  ];
  const id = await world.agents.save("owner", null, input(parameters));
  let agent = (await world.agents.visibleAgents("owner")).agents[0];
  expect(agent.configuration.parameters).toEqual(parameters);
  expect(agent.configuration.run?.timeoutMinutes).toBe(0);
  expect(resolve).toHaveBeenCalledWith("owner", "ticket-id");
  await world.agents.save("owner", id, {
    ...input([]),
    revision: agent.revision,
  });
  agent = (await world.agents.visibleAgents("owner")).agents[0];
  expect(agent.configuration.parameters).toEqual([]);
  expect((await world.files.read(id)).configuration.parameters).toEqual([]);
});

it("allows only the active owner to remove an agent, including after model access is withdrawn", async () => {
  const id = await world.agents.save("owner", null, input());
  await expect(world.agents.remove("other", id)).rejects.toThrow(
    new AgentError("agent_usage_denied"),
  );
  await expect(world.agents.remove("admin", id)).rejects.toThrow(
    new AgentError("agent_usage_denied"),
  );
  await expect(world.agents.remove("other", "missing")).rejects.toThrow(
    new AgentError("agent_usage_denied"),
  );
  world.withdrawModel("model");
  await world.agents.remove("owner", id);
  expect((await world.agents.visibleAgents("owner")).agents).toEqual([]);
  expect(world.storedAgents()).toEqual([]);
});

it("keeps a running agent immutable and allows deletion after the run releases it", async () => {
  const id = await world.agents.save("owner", null, input());
  const release = await world.files.hold([id]);
  await expect(world.agents.remove("owner", id)).rejects.toThrow(
    new AgentError("profile_running"),
  );
  await release();
  await world.agents.remove("owner", id);
  expect(world.storedAgents()).toEqual([]);
});

it("rejects deletion after the owner's account is deactivated", async () => {
  const id = await world.agents.save("owner", null, input());
  world.addPerson("owner", { isActive: false });
  await expect(world.agents.remove("owner", id)).rejects.toMatchObject({
    code: "accessDenied",
  });
  expect(world.storedAgents()).toHaveLength(1);
});

it("refuses a ticket whose access was revoked before saving", async () => {
  resolve.mockRejectedValueOnce(new AgentError("parameter_ticket_unavailable"));
  await expect(
    world.agents.save(
      "owner",
      null,
      input([
        {
          name: "ticketID",
          type: "ticket",
          description: "",
          isRequired: true,
          defaultValue: { type: "ticket", ticketId: "hidden" },
        },
      ]),
    ),
  ).rejects.toThrow(new AgentError("parameter_ticket_unavailable"));
  expect(world.storedAgents()).toEqual([]);
});
