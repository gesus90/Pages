import { afterEach, expect, it, vi } from "vitest";

import {
  CliHostMcpServers,
  mergeHostMcpServers,
  readsHostMcpConfiguration,
} from "@/backend/agents/cli/CliHostMcpServers";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  logCaughtError: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));

afterEach(() => {
  mocks.readFile.mockReset();
  mocks.logCaughtError.mockReset();
});

function discoveryFor(
  files: Readonly<Record<string, string>>,
  environment: Readonly<Record<string, string | undefined>> = {},
): CliHostMcpServers {
  return new CliHostMcpServers({
    home: "/synthetic",
    environment,
    read: async (file) => files[file] ?? null,
  });
}

it("reads remote Claude entries from every URL field and keeps stdio entries whole", async () => {
  const servers = await discoveryFor({
    "/synthetic/.claude.json": JSON.stringify({
      mcpServers: {
        http: { url: "https://one.invalid" },
        gemini: { httpUrl: "https://two.invalid", type: "http" },
        antigravity: { serverUrl: "https://three.invalid" },
        blank: { command: "  ", url: "" },
        nothing: { command: "   " },
        spaced: { command: "tool", env: "invalid" },
      },
    }),
  }).servers("claude_code");
  expect(servers.map((entry) => entry.server)).toEqual([
    { type: "http", name: "http", url: "https://one.invalid", headers: [] },
    { type: "http", name: "gemini", url: "https://two.invalid", headers: [] },
    {
      type: "http",
      name: "antigravity",
      url: "https://three.invalid",
      headers: [],
    },
    { name: "spaced", command: "tool", args: [], env: [] },
  ]);
});

it("skips a stdio server whose command list has no program", async () => {
  const servers = await discoveryFor(
    {
      "/xdg/opencode/opencode.json": JSON.stringify({
        mcp: {
          empty: { type: "local", command: [] },
          blank: { type: "local", command: ["  "] },
          off: { type: "local", command: ["tool"], enabled: false },
          noUrl: { type: "remote" },
          remote: {
            type: "remote",
            url: "https://example.invalid",
            headers: { A: "b" },
          },
          text: "not an entry",
        },
      }),
    },
    { XDG_CONFIG_HOME: "/xdg" },
  ).servers("opencode");
  expect(servers.map((entry) => entry.server)).toEqual([
    {
      type: "http",
      name: "remote",
      url: "https://example.invalid",
      headers: [{ name: "A", value: "b" }],
    },
  ]);
});

it("falls back to the default configuration folders of OpenCode and Codex", async () => {
  const read = vi.fn(async () => null);
  const discovery = new CliHostMcpServers({
    home: "/synthetic",
    environment: {},
    read,
  });
  await discovery.servers("opencode");
  await discovery.servers("codex_cli");
  expect(read.mock.calls).toEqual([
    ["/synthetic/.config/opencode/opencode.json"],
    ["/synthetic/.codex/config.toml"],
  ]);
});

it("reads Codex commands with headers and skips entries without a command or URL", async () => {
  const servers = await discoveryFor({
    "/synthetic/.codex/config.toml": [
      "[mcp_servers.local]",
      'command = "tool"',
      'args = ["a"]',
      "[mcp_servers.local.env]",
      'KEY = "value"',
      "[mcp_servers.remote]",
      'url = "https://example.invalid"',
      "[mcp_servers.remote.http_headers]",
      'Authorization = "synthetic"',
      "[mcp_servers.empty]",
      'note = "none"',
      "[mcp_servers.pages]",
      'command = "reserved"',
    ].join("\n"),
  }).servers("codex_cli");
  expect(servers).toEqual([
    {
      server: {
        name: "local",
        command: "tool",
        args: ["a"],
        env: [{ name: "KEY", value: "value" }],
      },
      summary: {
        name: "local",
        transport: "stdio",
        source: "~/.codex/config.toml",
      },
    },
    {
      server: {
        type: "http",
        name: "remote",
        url: "https://example.invalid",
        headers: [{ name: "Authorization", value: "synthetic" }],
      },
      summary: {
        name: "remote",
        transport: "http",
        source: "~/.codex/config.toml",
      },
    },
  ]);
});

it("returns nothing for documents without a server table or a JSON object", async () => {
  for (const [provider, file, content] of [
    ["claude_code", "/synthetic/.claude.json", "{}"],
    ["claude_code", "/synthetic/.claude.json", "[1]"],
    ["claude_code", "/synthetic/.claude.json", "5"],
    ["opencode", "/synthetic/.config/opencode/opencode.json", "{}"],
    ["codex_cli", "/synthetic/.codex/config.toml", 'name = "none"'],
  ] as const)
    expect(await discoveryFor({ [file]: content }).servers(provider)).toEqual(
      [],
    );
  expect(mocks.logCaughtError).not.toHaveBeenCalled();
});

it("shows a path outside the home as it is and an inside path with a tilde", async () => {
  const outside = await discoveryFor(
    {
      "/elsewhere/codex/config.toml":
        '[mcp_servers.one]\nurl = "https://example.invalid"',
    },
    { CODEX_HOME: "/elsewhere/codex" },
  ).servers("codex_cli");
  expect(outside[0]?.summary.source).toBe("/elsewhere/codex/config.toml");
  const lookalike = await discoveryFor(
    {
      "/synthetic-other/config.toml":
        '[mcp_servers.one]\nurl = "https://example.invalid"',
    },
    { CODEX_HOME: "/synthetic-other" },
  ).servers("codex_cli");
  expect(lookalike[0]?.summary.source).toBe("/synthetic-other/config.toml");
});

it("reads the default host files and treats a missing file as empty", async () => {
  mocks.readFile.mockImplementation(async (file: string) => {
    if (file.endsWith(".claude.json")) throw missing("ENOENT");
    throw missing("ENOTDIR");
  });
  const discovery = new CliHostMcpServers({ home: "/h", environment: {} });
  expect(await discovery.servers("claude_code")).toEqual([]);
  expect(await discovery.servers("antigravity")).toEqual([]);
  expect(mocks.readFile).toHaveBeenCalledWith("/h/.claude.json", "utf8");
  expect(mocks.logCaughtError).not.toHaveBeenCalled();
});

it("logs a read failure with another code and a failure that is no error", async () => {
  mocks.readFile.mockRejectedValueOnce(missing("EACCES"));
  mocks.readFile.mockRejectedValueOnce(new Error("plain"));
  mocks.readFile.mockRejectedValueOnce("text");
  const discovery = new CliHostMcpServers({ home: "/h", environment: {} });
  expect(await discovery.servers("claude_code")).toEqual([]);
  expect(await discovery.servers("claude_code")).toEqual([]);
  expect(await discovery.servers("claude_code")).toEqual([]);
  expect(mocks.logCaughtError).toHaveBeenCalledTimes(3);
});

it("uses the real home and environment by default", async () => {
  const discovery = new CliHostMcpServers();
  for (const provider of [
    "anthropic",
    "openai",
    "openrouter",
    "google_ai_studio",
  ] as const)
    expect(await discovery.servers(provider)).toEqual([]);
});

it("tells which provider reads the host configuration itself", () => {
  expect(readsHostMcpConfiguration("opencode")).toBe(true);
  expect(readsHostMcpConfiguration("claude_code")).toBe(false);
});

it("merges host servers after the base servers without replacing a name", () => {
  const base = [{ name: "browser", command: "b", args: [], env: [] }];
  const host = [
    { name: "browser", command: "x", args: [], env: [] },
    { name: "pages", command: "x", args: [], env: [] },
    { name: "pages-pica", command: "x", args: [], env: [] },
    { name: "extra", command: "y", args: [], env: [] },
    { name: "extra", command: "z", args: [], env: [] },
  ];
  expect(mergeHostMcpServers(base, host)).toEqual([
    base[0],
    { name: "extra", command: "y", args: [], env: [] },
  ]);
});

function missing(code: string): Error {
  return Object.assign(new Error(code), { code });
}
