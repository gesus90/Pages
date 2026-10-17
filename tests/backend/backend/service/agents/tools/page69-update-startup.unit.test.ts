import { expect, it } from "vitest";

import { TOOL_ADMIN, toolLocation, toolWorld } from "./page69-tool-world";

function olderAdapter(): ReturnType<typeof toolWorld> {
  const world = toolWorld();
  const old = toolLocation("codex_acp", "2.1.1");
  world.current.set("codex_acp", old);
  world.outcomes.set(old.file, {
    status: "ready",
    diagnostic: "ready",
    version: "2.1.1",
  });
  return world;
}

it("automatically applies a new reviewed startup target and retains the old generation", async () => {
  const world = olderAdapter();
  await world.storage.writeEnabled(["codex_acp"]);
  await world.manager.start();
  expect(
    world.install.mock.calls.filter(([tool]) => tool.id === "codex_acp"),
  ).toHaveLength(1);
  expect(world.current.get("codex_acp")).toMatchObject({
    version: "2.2.2",
    approvedTarget: "2.2.2",
  });
  await world.manager.manage(TOOL_ADMIN, "codex_acp", "rollback");
  expect(world.current.get("codex_acp")?.version).toBe("2.1.1");
  world.install.mockClear();
  const restarted = world.recreate();
  await restarted.start();
  expect(world.current.get("codex_acp")?.version).toBe("2.1.1");
  expect(world.install).not.toHaveBeenCalled();
});

it("preserves a compatible adopted system adapter instead of replacing it unattended", async () => {
  const world = olderAdapter();
  const old = world.current.get("codex_acp");
  if (!old) throw new Error("Missing fixture");
  world.current.delete("codex_acp");
  world.system.set("codex_acp", { ...old, source: "system", release: null });
  await world.storage.writeEnabled(["codex_acp"]);
  await world.manager.start();
  expect(
    world.install.mock.calls.some(([tool]) => tool.id === "codex_acp"),
  ).toBe(false);
  expect(
    world.manager.list(TOOL_ADMIN).find((tool) => tool.id === "codex_acp"),
  ).toMatchObject({
    status: "ready",
    installedVersion: "2.1.1",
    updateAvailable: true,
  });
});

it("keeps the old approved generation when an automatic candidate fails and starts Pages", async () => {
  const world = olderAdapter();
  world.install.mockImplementation(async (tool) => {
    if (tool.id === "codex_acp") throw new Error("synthetic registry failure");
  });
  await world.storage.writeEnabled(["codex_acp"]);
  await expect(world.manager.start()).resolves.toBeUndefined();
  expect(world.current.get("codex_acp")?.version).toBe("2.1.1");
  expect(world.removed).toEqual([]);
  expect(world.discarded).toHaveLength(1);
  await expect(world.manager.ensureTool("codex_acp")).resolves.toMatchObject({
    version: "2.1.1",
  });
});
