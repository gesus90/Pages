import { beforeEach, expect, it, vi } from "vitest";

import { AgentToolFiles } from "@/backend/service/agents/tools/AgentToolFiles";
import { agentToolDefinition } from "@/backend/service/agents/tools/AgentToolRegistry";

const memory = vi.hoisted(() => {
  const writes: string[] = [];
  const renames: string[] = [];
  return {
    content: new Map<string, string>(),
    symlinks: new Set<string>(),
    writes,
    renames,
  };
});
vi.mock("node:fs/promises", () => ({
  access: async () => undefined,
  mkdir: async () => undefined,
  lstat: async (file: string) => ({
    isDirectory: () => true,
    isSymbolicLink: () => memory.symlinks.has(file),
    mode: 0o700,
  }),
  readFile: async (file: string) => {
    const content = memory.content.get(file);
    if (content === undefined)
      throw Object.assign(new Error("Missing"), { code: "ENOENT" });
    return content;
  },
  writeFile: async (file: string, content: string) => {
    memory.content.set(file, content);
    memory.writes.push(file);
  },
  rename: async (from: string, to: string) => {
    const content = memory.content.get(from);
    if (content === undefined) throw new Error("Missing candidate");
    memory.content.set(to, content);
    memory.content.delete(from);
    memory.renames.push(to);
  },
  rm: async (file: string) => {
    memory.content.delete(file);
  },
}));

beforeEach(() => {
  memory.content.clear();
  memory.symlinks.clear();
  memory.writes.length = 0;
  memory.renames.length = 0;
});

it("publishes by atomic rename, keeps the old generation and restores it on rollback", async () => {
  const files = new AgentToolFiles("/memory/instance/tools");
  const tool = agentToolDefinition("codex");
  const first = await files.candidate(tool);
  await files.activate(tool, first);
  const second = await files.candidate(tool);
  await files.activate(tool, second);
  expect((await files.current(tool))?.file).toBe(second.file);
  expect((await files.previous(tool))?.file).toBe(first.file);
  await files.activate(tool, first);
  expect(memory.renames).toEqual(
    Array(3).fill("/memory/instance/tools/codex/active.json"),
  );
  expect(
    memory.writes.every((file) => file.startsWith("/memory/instance/tools/")),
  ).toBe(true);
});

it("refuses unsafe stored release names and symlinked installation roots", async () => {
  const files = new AgentToolFiles("/memory/instance/tools");
  const tool = agentToolDefinition("codex");
  memory.content.set(
    "/memory/instance/tools/codex/active.json",
    JSON.stringify({ current: "../../credentials", previous: null }),
  );
  await expect(files.current(tool)).rejects.toThrow("Invalid release name");
  memory.symlinks.add("/memory/instance/tools");
  await expect(files.candidate(tool)).rejects.toThrow("Unsafe tool directory");
});

it("retains the actual approved generation version after an update and rollback", async () => {
  const files = new AgentToolFiles("/memory/instance/tools");
  const tool = agentToolDefinition("codex_acp");
  const first = await files.candidate({ ...tool, version: "2.1.1" });
  await files.activate(tool, first);
  const second = await files.candidate(tool);
  await files.activate(tool, second);
  expect((await files.current(tool))?.version).toBe("2.2.2");
  expect((await files.previous(tool))?.version).toBe("2.1.1");
  await files.activate(tool, first);
  expect((await files.current(tool))?.version).toBe("2.1.1");
  expect((await files.current(tool))?.approvedTarget).toBe("2.2.2");
});

it("persists only fixed enablement IDs and rejects malformed configuration", async () => {
  const files = new AgentToolFiles("/memory/instance/tools");
  await files.writeEnabled(["playwright_mcp", "playwright_mcp"]);
  expect(await files.readEnabled()).toEqual(["playwright_mcp"]);
  memory.content.set(
    "/memory/instance/tools/enabled.json",
    '["arbitrary-shell-command"]',
  );
  await expect(files.readEnabled()).rejects.toThrow("Invalid tool settings");
});
