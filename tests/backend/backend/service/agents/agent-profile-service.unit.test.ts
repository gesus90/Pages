import { beforeEach, expect, it, vi } from "vitest";

import { PageAgentWorld } from "./page-agent-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

let world = new PageAgentWorld();

beforeEach(() => {
  world = new PageAgentWorld();
  world.addPerson("admin", { isAdmin: true });
  world.addPerson("owner");
  world.addModel("model");
  world.seedAgent({
    id: "personal",
    ownerId: "owner",
    modelProfileId: "model",
  });
});

it("keeps personal agents out of the administrative list and identifies them separately", async () => {
  const actor = world
    .snapshot()
    .accounts.find((account) => account.userId === "admin");
  if (!actor) throw new Error("Missing administrator");
  expect(
    (await world.administration.list(actor)).map((profile) => profile.id),
  ).toEqual(["model"]);
  expect([...(await world.administration.userAgentIds(actor))]).toEqual([
    "personal",
  ]);
  expect(await world.administration.directory(actor)).toMatchObject({
    persons: [
      { id: "admin", name: "admin Tester" },
      { id: "owner", name: "owner Tester" },
    ],
  });
});

it("rechecks administration rights and refuses personal agent removal", async () => {
  const actor = world
    .snapshot()
    .accounts.find((account) => account.userId === "admin");
  if (!actor) throw new Error("Missing administrator");
  await expect(
    world.administration.remove(actor, "personal"),
  ).rejects.toMatchObject({ code: "agent_usage_denied" });
  await expect(
    world.administration.remove(actor, "missing"),
  ).rejects.toMatchObject({ code: "profile_not_found" });
  world.changePerson("admin", { isActive: false });
  await expect(world.administration.list(actor)).rejects.toMatchObject({
    code: "accessDenied",
  });
  expect(world.storedAgents().map((profile) => profile.id)).toEqual([
    "personal",
  ]);
});

it("requires a selection for agent execution and validates a purpose", async () => {
  await expect(
    world.administration.resolve("owner", "agent"),
  ).rejects.toMatchObject({ code: "profileSelectionRequired" });
  await expect(
    world.administration.choices("owner", "unknown"),
  ).rejects.toMatchObject({ code: "invalidInput" });
  await expect(
    world.administration.resolve("owner", "chat"),
  ).rejects.toMatchObject({ code: "roleMissing" });
});
