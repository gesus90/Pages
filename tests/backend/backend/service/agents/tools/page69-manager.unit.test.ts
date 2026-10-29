import { beforeEach, expect, it, vi } from "vitest";

import {
  agentToolDefinition,
  isAgentToolVersionSupported,
} from "@/backend/service/agents/tools/AgentToolRegistry";

import { TOOL_ADMIN, toolLocation, toolWorld } from "./page69-tool-world";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

it("installs and verifies a missing tool once and uses its managed generation", async () => {
  const world = toolWorld();
  await world.manager.ensureTool("codex");
  await world.manager.ensureTool("codex");
  expect(world.install).toHaveBeenCalledTimes(1);
  expect(world.activate).toHaveBeenCalledTimes(1);
  expect(
    world.manager.list(TOOL_ADMIN).find((tool) => tool.id === "codex"),
  ).toMatchObject({
    status: "ready",
    installed: true,
    source: "managed",
    installedVersion: "0.160.0",
  });
});

it("adopts an existing compatible system tool without installation", async () => {
  const world = toolWorld();
  world.system.set("codex", toolLocation("codex", "0.160.0", "system"));
  expect((await world.manager.ensureTool("codex")).source).toBe("system");
  expect(world.install).not.toHaveBeenCalled();
});

it("recognizes incompatible versions and replaces them only with a verified allowlisted release", async () => {
  const world = toolWorld();
  const old = toolLocation("codex", "99.0.0", "system");
  world.system.set("codex", old);
  world.outcomes.set(old.file, {
    status: "unsupported",
    diagnostic: "version_unsupported",
    version: "99.0.0",
  });
  await world.manager.manage(TOOL_ADMIN, "codex", "check");
  expect(
    world.manager.list(TOOL_ADMIN).find((tool) => tool.id === "codex")?.status,
  ).toBe("unsupported");
  await world.manager.ensureTool("codex");
  expect(world.install).toHaveBeenCalledOnce();
  expect(
    isAgentToolVersionSupported(agentToolDefinition("codex"), "99.0.0"),
  ).toBe(false);
  expect(
    isAgentToolVersionSupported(agentToolDefinition("node"), "22.21.9"),
  ).toBe(false);
});

it("repairs a broken managed installation using a new generation", async () => {
  const world = toolWorld();
  const broken = toolLocation("codex", "broken");
  world.current.set("codex", broken);
  world.outcomes.set(broken.file, {
    status: "failed",
    diagnostic: "execution_failed",
    version: null,
  });
  await world.manager.ensureTool("codex");
  expect(world.current.get("codex")).not.toEqual(broken);
  expect(world.discarded).toEqual([]);
});

it("coordinates simultaneous installations and shares the verified result", async () => {
  const world = toolWorld();
  await Promise.all([
    world.manager.ensureTool("codex_acp"),
    world.manager.ensureTool("codex_acp"),
    world.manager.ensureTool("codex"),
  ]);
  expect(world.install.mock.calls.map(([tool]) => tool.id).sort()).toEqual([
    "codex",
    "codex_acp",
  ]);
});

it("keeps the previous working release on failed update and supports explicit rollback", async () => {
  const world = toolWorld();
  const first = toolLocation("codex_acp", "2.1.1");
  world.current.set("codex_acp", first);
  world.outcomes.set(first.file, {
    status: "ready",
    diagnostic: "ready",
    version: "2.1.1",
  });
  await world.manager.ensureTool("codex_acp");
  await world.manager.manage(TOOL_ADMIN, "codex_acp", "update");
  expect(world.current.get("codex_acp")).not.toEqual(first);
  await world.manager.manage(TOOL_ADMIN, "codex_acp", "rollback");
  expect(world.current.get("codex_acp")).toEqual({
    ...first,
    approvedTarget: "2.2.2",
  });
  world.install.mockRejectedValueOnce(new Error("synthetic download failure"));
  await expect(
    world.manager.manage(TOOL_ADMIN, "codex_acp", "update"),
  ).rejects.toMatchObject({
    tool: "codex_acp",
    diagnostic: "installation_failed",
  });
  expect(world.current.get("codex_acp")).toEqual({
    ...first,
    approvedTarget: "2.2.2",
  });
  expect(world.discarded).toHaveLength(1);
});

it("does not reinstall a tool already on its approved update target", async () => {
  const world = toolWorld();
  await world.manager.ensureTool("codex");
  world.install.mockClear();
  await world.manager.manage(TOOL_ADMIN, "codex", "update");
  expect(world.install).not.toHaveBeenCalled();
});

it("rejects a candidate whose functional health fails before activation", async () => {
  const world = toolWorld();
  world.install.mockImplementation(async (tool, candidate) => {
    expect(tool.id).toBe("codex");
    world.outcomes.set(candidate.file, {
      status: "failed",
      diagnostic: "handshake_failed",
      version: null,
    });
  });
  await expect(world.manager.ensureTool("codex")).rejects.toMatchObject({
    diagnostic: "handshake_failed",
  });
  expect(world.activate).not.toHaveBeenCalled();
});

it("blocks installation on missing write permission without touching login storage", async () => {
  const world = toolWorld();
  vi.spyOn(world.storage, "candidate").mockRejectedValue(
    Object.assign(new Error("Denied"), { code: "EACCES" }),
  );
  await expect(world.manager.ensureTool("codex")).rejects.toMatchObject({
    diagnostic: "permission_denied",
  });
  expect(world.install).not.toHaveBeenCalled();
  expect(world.removed).toEqual([]);
});

it("restores enabled tools after a server restart without reinstalling healthy generations", async () => {
  const world = toolWorld();
  await world.manager.setEnabled(TOOL_ADMIN, "codex_acp", true);
  world.install.mockClear();
  const restarted = world.recreate();
  await restarted.start();
  expect(
    restarted.list(TOOL_ADMIN).find((tool) => tool.id === "codex_acp"),
  ).toMatchObject({ enabled: true, status: "ready" });
  expect(world.install).not.toHaveBeenCalled();
});

it("does not fail Pages startup when an optional integration cannot be installed", async () => {
  const world = toolWorld();
  world.install.mockRejectedValue(new Error("offline"));
  await expect(world.manager.start(["codex_cli"])).resolves.toBeUndefined();
  expect(
    world.manager.list(TOOL_ADMIN).find((tool) => tool.id === "codex_acp")
      ?.status,
  ).toBe("missing_dependency");
});

it("blocks a run before leasing native capacity when a required dependency fails", async () => {
  const world = toolWorld();
  world.system.delete("bubblewrap");
  await expect(
    world.manager.ensureReady({
      provider: "codex_cli",
      hasPagesMcp: true,
      browser: false,
      instanceId: "run",
    }),
  ).rejects.toMatchObject({ tool: "bubblewrap", diagnostic: "not_installed" });
  expect(world.manager.supervisor.activities("codex")).toEqual([]);
});

it("requires explicit optional browser access and refuses removal during active sessions", async () => {
  const world = toolWorld();
  await expect(
    world.manager.ensureReady({
      provider: "codex_cli",
      hasPagesMcp: true,
      browser: true,
      instanceId: "run",
    }),
  ).rejects.toMatchObject({ diagnostic: "disabled" });
  await world.manager.ensureReady({
    provider: "codex_cli",
    hasPagesMcp: true,
    browser: false,
    instanceId: "run",
  });
  world.manager.supervisor.identify("run", {
    processId: 4242,
    sessionId: "session",
  });
  expect(
    world.manager.list(TOOL_ADMIN).find((tool) => tool.id === "codex")
      ?.activities,
  ).toMatchObject([{ processId: 4242, sessionId: "session" }]);
  await expect(
    world.manager.manage(TOOL_ADMIN, "codex", "remove"),
  ).rejects.toMatchObject({ diagnostic: "active_sessions" });
  await world.manager.manage(TOOL_ADMIN, "codex", "update");
  world.manager.supervisor.release("run");
  await world.manager.manage(TOOL_ADMIN, "codex", "remove");
  expect(world.removed).toEqual(["codex"]);
});

it.each([
  { ...TOOL_ADMIN, isAdmin: false },
  { ...TOOL_ADMIN, mode: "role" as const },
  { ...TOOL_ADMIN, isActive: false },
])(
  "refuses unauthorized management and reads before external work",
  async (actor) => {
    const world = toolWorld();
    expect(() => world.manager.list(actor)).toThrow("Administrator");
    await expect(
      world.manager.manage(actor, "codex", "install"),
    ).rejects.toThrow("Administrator");
    await expect(
      world.manager.setEnabled(actor, "playwright_mcp", true),
    ).rejects.toThrow("Administrator");
    expect(world.install).not.toHaveBeenCalled();
  },
);

it("refuses an install candidate reporting a different approved version than the pinned target", async () => {
  const world = toolWorld();
  world.install.mockImplementation(async (tool, candidate) => {
    if (tool.id === "codex_acp")
      world.outcomes.set(candidate.file, {
        status: "ready",
        diagnostic: "ready",
        version: "2.1.1",
      });
  });
  await expect(world.manager.ensureTool("codex_acp")).rejects.toMatchObject({
    tool: "codex_acp",
    diagnostic: "version_unsupported",
  });
  expect(world.current.has("codex_acp")).toBe(false);
});

it("installs the official Antigravity binary distribution without an npm package and pins its generation", async () => {
  const world = toolWorld();
  const first = await world.manager.ensureTool("antigravity_acp");
  expect(first.source).toBe("managed");
  expect(world.install).toHaveBeenCalledOnce();
  expect(world.install.mock.calls[0]?.[0]).toMatchObject({
    id: "antigravity_acp",
    packageName: null,
    version: "1.4.4",
  });
  await world.manager.ensureTool("antigravity_acp");
  expect(world.install).toHaveBeenCalledOnce();
  expect(
    world.manager
      .list(TOOL_ADMIN)
      .find((tool) => tool.id === "antigravity_acp"),
  ).toMatchObject({
    installed: true,
    installedVersion: "1.4.4",
    approvedVersion: "1.4.4",
  });
});
