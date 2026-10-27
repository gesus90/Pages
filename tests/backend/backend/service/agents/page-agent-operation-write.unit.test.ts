import { beforeEach, describe, expect, it, vi } from "vitest";

import { PAGE_AGENT_WRITE_OPERATIONS } from "@/definition/PageAgentOperations";

import { memoryFiles } from "./page-agent-files";
import { PageAgentWorld } from "./page-agent-world";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

let world = new PageAgentWorld();

beforeEach(() => {
  memoryFiles.reset();
  world = new PageAgentWorld();
  world.addPerson("owner");
  world.addPerson("member");
  world.addModel("model-1", { efforts: ["low", "medium", "high"] });
});

// PAGE-124 moved models and instructions into the plan nodes; the stored
// definitions stay readable, and every change to one is refused.
describe("retired agent definition writes", () => {
  it.each(PAGE_AGENT_WRITE_OPERATIONS)(
    "refuses %s as retired and changes nothing",
    async (operation) => {
      world.seedAgent({
        id: "mine",
        ownerId: "owner",
        modelProfileId: "model-1",
      });
      const before = JSON.stringify(world.stored());

      await expect(
        world.call("owner", operation, {
          operationId: "retired-1",
          agentId: "mine",
          expectedRevision: 1,
          name: "Renamed",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        details: { reason: "operation_retired" },
      });

      expect(JSON.stringify(world.stored())).toBe(before);
      expect(memoryFiles.writes).toEqual([]);
    },
  );

  it("refuses a retired write even without any input or stored agent", async () => {
    await expect(world.call("member", "agents.create")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      details: { reason: "operation_retired" },
    });
  });

  it("leaves a name that belongs to another operation service unhandled", async () => {
    const response = await world.operations.handle(
      world.identity("owner"),
      "projects.names.list",
      {},
    );
    expect(response).toBeNull();
  });
});

it("refuses a list page that exceeds the response budget and serves a smaller one", async () => {
  for (let index = 0; index < 6; index += 1) {
    world.seedAgent({
      id: `big-${index}`,
      ownerId: "owner",
      modelProfileId: "model-1",
    });
    const stored = world.stored().find((entry) => entry.id === `big-${index}`);
    if (stored?.configuration)
      world.replace({
        ...stored,
        configuration: {
          ...stored.configuration,
          markdown: "x".repeat(200_000),
        },
      });
  }

  await expect(world.call("owner", "agents.list", {})).rejects.toMatchObject({
    code: "PAYLOAD_TOO_LARGE",
    details: { constraint: "responseBytes", limit: 1_048_576 },
  });
  await expect(
    world.call("owner", "agents.list", { limit: 2 }),
  ).resolves.toMatchObject({ total: 6 });
});
