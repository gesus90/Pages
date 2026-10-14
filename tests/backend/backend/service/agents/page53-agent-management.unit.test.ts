import { beforeEach, expect, it, vi } from "vitest";

import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { memoryFiles } from "./page-agent-files";
import { PageAgentWorld } from "./page-agent-world";

import type { AccountAccess } from "@/definition/Authorization";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

let world: PageAgentWorld;
beforeEach(() => {
  memoryFiles.reset();
  world = new PageAgentWorld();
  world.addPerson("admin", { isAdmin: true });
  world.addPerson("owner");
  world.addModel("model");
});

function account(id: string): AccountAccess {
  const actor = world.snapshot().accounts.find((entry) => entry.userId === id);
  if (!actor) throw new Error("Missing synthetic account");
  return actor;
}

it("allows an admin to remove a model with assignments without asking for its usages", async () => {
  const remove = vi
    .spyOn(AgentProfileRepository.prototype, "removeWithReferences")
    .mockResolvedValue();
  const usages = vi.spyOn(AgentProfileRepository.prototype, "usages");
  await world.administration.remove(account("admin"), "model");
  expect(remove).toHaveBeenCalledExactlyOnceWith("model");
  expect(usages).not.toHaveBeenCalled();
});

it("checks persisted admin rights even if the caller supplies stale administrator facts", async () => {
  const actor = account("admin");
  world.changePerson("admin", { isAdmin: false });
  const remove = vi
    .spyOn(AgentProfileRepository.prototype, "removeWithReferences")
    .mockResolvedValue();
  await expect(
    world.administration.remove(actor, "model"),
  ).rejects.toBeInstanceOf(AgentAccessDeniedError);
  await expect(
    world.administration.remove(account("owner"), "model"),
  ).rejects.toBeInstanceOf(AgentAccessDeniedError);
  expect(remove).not.toHaveBeenCalled();
});

it("retains the owner boundary and active run guard", async () => {
  const remove = vi
    .spyOn(AgentProfileRepository.prototype, "removeWithReferences")
    .mockResolvedValue();
  world.seedAgent({ id: "owned", ownerId: "owner", modelProfileId: "model" });
  await expect(
    world.administration.remove(account("admin"), "owned"),
  ).rejects.toMatchObject({ code: "agent_usage_denied" });
  const release = await world.files.hold(["model"]);
  await expect(
    world.administration.remove(account("admin"), "model"),
  ).rejects.toMatchObject({ code: "profile_running" });
  expect(remove).not.toHaveBeenCalled();
  await release();
  await world.administration.remove(account("admin"), "model");
  expect(remove).toHaveBeenCalledOnce();
});

it("keeps a detached user agent visible, blocks execution, and allows the owner to reassign a released model", async () => {
  world.seedAgent({ id: "owned", ownerId: "owner", modelProfileId: "model" });
  const [previous] = world.storedAgents();
  world.withdrawModel("model");
  world.replace({ ...previous, modelProfileId: "", revision: 2 });
  const [shown] = (await world.agents.page("owner")).agents;
  expect(shown).toMatchObject({
    id: "owned",
    modelProfileId: "",
    canEdit: true,
    availability: { isUsable: false, reason: "model_assignment_missing" },
  });
  await expect(
    world.administration.resolveDefinition("owner", {
      agentId: "owned",
      personalAgentId: null,
      projectId: null,
    }),
  ).rejects.toMatchObject({ code: "model_assignment_missing" });
  world.addModel("replacement");
  await world.agents.save("owner", "owned", {
    name: previous.name,
    modelProfileId: "replacement",
    reasoningEffort: null,
    configuration: previous.configuration ?? emptyAgentConfiguration(),
    revision: 2,
  });
  expect((await world.agents.page("owner")).agents[0]).toMatchObject({
    id: "owned",
    modelProfileId: "replacement",
    availability: { isUsable: true, reason: null },
  });
});

it("rejects a stale owner edit after a model reference was cleared", async () => {
  world.seedAgent({ id: "owned", ownerId: "owner", modelProfileId: "model" });
  const [previous] = world.storedAgents();
  world.replace({ ...previous, modelProfileId: "", revision: 2 });
  await expect(
    world.agents.save("owner", "owned", previous),
  ).rejects.toMatchObject({ code: "profile_conflict" });
  expect(world.storedAgents()[0].modelProfileId).toBe("");
});
