import { expect, it, vi } from "vitest";

import { agentPlaywrightServer } from "@/backend/service/agents/tools/AgentPlaywrightSession";
import {
  agentRunOptionsFor,
  isAgentRunOptionsAllowed,
  acpRunOptions,
} from "@/definition/AgentConfiguration";

import { toolSessionInput } from "./page69-runtime-world";
import { toolLocation } from "./page69-tool-world";

import type { AgentToolId } from "@/definition/AgentTools";
import type { AgentToolLocation } from "@/backend/service/agents/tools/AgentToolContracts";

const files = vi.hoisted(() => ({ hasSymlink: false }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  lstat: async () => ({
    isDirectory: () => !files.hasSymlink,
    isSymbolicLink: () => files.hasSymlink,
  }),
  realpath: async (file: string) => file,
}));

it("does not offer browser MCP without explicit agent permission", async () => {
  expect(await agentPlaywrightServer(toolSessionInput(), new Map())).toBeNull();
});

it("offers fixed headless sandboxed browser arguments and per-session artifacts after explicit opt-in", async () => {
  files.hasSymlink = false;
  const input = {
    ...toolSessionInput(),
    options: { ...acpRunOptions("yolo", 0), browser: true },
  };
  const locations = new Map<AgentToolId, AgentToolLocation>([
    ["playwright_mcp", toolLocation("playwright_mcp")],
    ["chromium", toolLocation("chromium")],
  ]);
  const server = await agentPlaywrightServer(input, locations);
  expect(server).toMatchObject({
    name: "playwright",
    command: "/memory/tools/playwright_mcp/synthetic/bin",
    args: [
      "--headless",
      "--browser",
      "chromium",
      "--isolated",
      "--sandbox",
      "--save-session",
      "--output-dir",
      "/memory/workspace/.pages-artifacts/managed-session",
    ],
  });
  expect(server?.env).toContainEqual({
    name: "PAGES_RUN_INSTANCE",
    value: input.instanceId,
  });
  expect(JSON.stringify(server)).not.toContain("TOKEN");
  expect(JSON.stringify(server)).not.toContain("--no-sandbox");
});

it("refuses browser access in read-only mode and preserves the explicit option during normalization", async () => {
  const input = {
    ...toolSessionInput(),
    options: { ...acpRunOptions("read_only", 0), browser: true },
  };
  await expect(agentPlaywrightServer(input, new Map())).rejects.toMatchObject({
    diagnostic: "browser_permission_required",
  });
  expect(isAgentRunOptionsAllowed("codex_cli", input.options, undefined)).toBe(
    false,
  );
  const options = { ...acpRunOptions("yolo", 0), browser: true };
  expect(agentRunOptionsFor("codex_cli", options).browser).toBe(true);
  expect(isAgentRunOptionsAllowed("codex_cli", options, undefined)).toBe(true);
});

it("refuses a symlinked artifact directory instead of writing outside the workspace", async () => {
  files.hasSymlink = true;
  const input = {
    ...toolSessionInput(),
    options: { ...acpRunOptions("yolo", 0), browser: true },
  };
  const locations = new Map<AgentToolId, AgentToolLocation>([
    ["playwright_mcp", toolLocation("playwright_mcp")],
    ["chromium", toolLocation("chromium")],
  ]);
  await expect(agentPlaywrightServer(input, locations)).rejects.toThrow(
    "Unsafe browser output",
  );
});
