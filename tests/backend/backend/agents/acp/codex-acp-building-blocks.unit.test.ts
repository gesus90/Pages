import { beforeEach, expect, it, vi } from "vitest";

import { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import {
  isSupportedCodexAcp,
  planCodexAcpLaunch,
} from "@/backend/agents/acp/CodexAcpAdapter";
import { findUnmanagedCodexConfiguration } from "@/backend/agents/acp/CodexAcpConfigurationGuard";
import {
  codexAcpProfile,
  decideCodexPermission,
} from "@/backend/agents/acp/CodexAcpProfile";

import type { AnyMessage } from "@agentclientprotocol/sdk";

const files = vi.hoisted(() => ({ existing: new Set<string>() }));
vi.mock("node:fs/promises", () => ({
  access: async (file: string) => {
    if (!files.existing.has(file)) throw new Error(`ENOENT ${file}`);
  },
}));

beforeEach(() => {
  files.existing.clear();
});

it("maps Nur Lesen to the read-only session mode without commands, apps or plugins", () => {
  const profile = codexAcpProfile("read_only");
  expect(profile.sessionMode).toBe("read-only");
  expect(profile.configuration).toEqual({
    cli_auth_credentials_store: "file",
    forced_login_method: "chatgpt",
    model_provider: "openai",
    web_search: "live",
    features: {
      shell_tool: false,
      unified_exec: false,
      apps: false,
      plugins: false,
      multi_agent: false,
    },
  });
  expect(profile.permissions).toMatchObject({ shell: "off", pagesMcp: "read" });
});

it("maps YOLO to full access with commands, but without accounts outside Pages", () => {
  const profile = codexAcpProfile("yolo");
  expect(profile.sessionMode).toBe("agent-full-access");
  expect(profile.configuration).toMatchObject({
    forced_login_method: "chatgpt",
    model_provider: "openai",
    features: { shell_tool: true, unified_exec: true, apps: false },
  });
  expect(profile.unattended).toContain("bubblewrap");
});

it.each([
  ["2.1.1", true],
  ["2.2.2", true],
  ["2.10.0", true],
  ["2.1.0", false],
  ["1.13.2", false],
  ["3.0.0", false],
  ["2.2.3-preview.7", false],
])("accepts codex-acp %s: %s", (version, isSupported) => {
  expect(
    isSupportedCodexAcp({ name: "@agentclientprotocol/codex-acp", version }),
  ).toBe(isSupported);
});

it("starts the adapter with the Codex CLI of the connection and keeps the MCP credential out of its environment", () => {
  const profile = codexAcpProfile("read_only");
  const launch = planCodexAcpLaunch({
    instanceId: "instance",
    runnerFile: "/synthetic/bin/codex",
    profile,
    mcp: {
      node: "/synthetic/bin/node",
      bundle: "/synthetic/mcp.cjs",
      url: "http://pages.invalid",
      token: "secret-run-token",
      tools: null,
    },
  });
  expect(launch.environment).toEqual({
    PAGES_RUN_INSTANCE: "instance",
    CODEX_PATH: "/synthetic/bin/codex",
    CODEX_CONFIG: JSON.stringify(profile.configuration),
    INITIAL_AGENT_MODE: "read-only",
    NO_BROWSER: "1",
  });
  expect(JSON.stringify(launch.environment)).not.toContain("secret-run-token");
  expect(launch.mcpServers[0]?.env).toContainEqual({
    name: "PAGES_TOKEN",
    value: "secret-run-token",
  });
  expect(
    planCodexAcpLaunch({
      instanceId: "instance",
      runnerFile: "/synthetic/bin/codex",
      profile,
      mcp: null,
    }).mcpServers,
  ).toEqual([]);
});

it("cancels a request it cannot answer with a matching option", () => {
  const request = {
    sessionId: "session",
    toolCall: { toolCallId: "call" },
    options: [
      { optionId: "allow", name: "Allow", kind: "allow_once" as const },
    ],
  };
  expect(decideCodexPermission("read_only", request)).toEqual({
    outcome: { outcome: "cancelled" },
    isDenied: true,
  });
  expect(decideCodexPermission("yolo", request)).toEqual({
    outcome: { outcome: "selected", optionId: "allow" },
    isDenied: false,
  });
});

it.each([
  ["no configuration file", [], null],
  [
    "a config.toml in the connection's Codex folder",
    ["/synthetic/home/codex/config.toml"],
    "/synthetic/home/codex/config.toml",
  ],
  [
    "a project configuration in the workspace",
    ["/synthetic/repo/.codex/config.toml"],
    "/synthetic/repo/.codex/config.toml",
  ],
  [
    "a project configuration at the Git root above the workspace",
    ["/synthetic/repo/.git", "/synthetic/repo/.codex/config.toml"],
    "/synthetic/repo/.codex/config.toml",
  ],
  [
    "a configuration above the Git root, which Codex does not read",
    ["/synthetic/repo/.git", "/synthetic/.codex/config.toml"],
    null,
  ],
] as const)("finds %s", async (scenario, existing, found) => {
  for (const file of existing) files.existing.add(file);
  const workspace = existing.some((file) => file.endsWith(".git"))
    ? "/synthetic/repo/package"
    : "/synthetic/repo";
  expect(
    await findUnmanagedCodexConfiguration("/synthetic/home/codex", workspace),
  ).toBe(found);
});

it("passes only JSON-RPC messages from the adapter output to the SDK and refuses to write to a gone process", async () => {
  const channel = new AcpLineChannel();
  const reader = channel.stream.readable.getReader();
  channel.receive("starting codex app-server");
  channel.receive(JSON.stringify({ level: "info" }));
  channel.receive(JSON.stringify({ jsonrpc: "2.0", method: "session/update" }));
  expect(await reader.read()).toEqual({
    done: false,
    value: { jsonrpc: "2.0", method: "session/update" },
  });
  const writer = channel.stream.writable.getWriter();
  const message: AnyMessage = { jsonrpc: "2.0", method: "session/cancel" };
  await expect(writer.write(message)).rejects.toThrow(
    "The ACP adapter no longer reads its input.",
  );
  channel.close();
  channel.close();
  channel.receive(JSON.stringify({ jsonrpc: "2.0", method: "late" }));
  expect(await reader.read()).toEqual({ done: true, value: undefined });
});
