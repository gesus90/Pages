import { expect, it, vi } from "vitest";

import { CliHostMcpServers } from "@/backend/agents/cli/CliHostMcpServers";

it("reads synthetic Claude configuration without starting its configured commands", async () => {
  const read = vi.fn(async () =>
    JSON.stringify({
      mcpServers: {
        local: {
          command: "tool",
          args: ["one", 3],
          env: { TOKEN: "synthetic", INVALID: 1 },
        },
        remote: {
          type: "sse",
          url: "https://example.invalid",
          headers: { X: "test" },
        },
        pages: { command: "reserved" },
        invalid: {},
      },
    }),
  );
  const discovery = new CliHostMcpServers({
    home: "/synthetic",
    environment: {},
    read,
  });
  const servers = await discovery.servers("claude_code");
  expect(read).toHaveBeenCalledWith("/synthetic/.claude.json");
  expect(servers).toEqual([
    {
      server: {
        name: "local",
        command: "tool",
        args: ["one"],
        env: [{ name: "TOKEN", value: "synthetic" }],
      },
      summary: { name: "local", transport: "stdio", source: "~/.claude.json" },
    },
    {
      server: {
        name: "remote",
        type: "sse",
        url: "https://example.invalid",
        headers: [{ name: "X", value: "test" }],
      },
      summary: { name: "remote", transport: "sse", source: "~/.claude.json" },
    },
  ]);
});

it("reads enabled Codex and OpenCode entries from their configured locations", async () => {
  const read = vi.fn(async (file: string) =>
    file.endsWith(".toml")
      ? '[mcp_servers.remote]\nurl = "https://example.invalid"\n[mcp_servers.disabled]\nenabled = false\ncommand = "ignore"'
      : JSON.stringify({
          mcp: {
            local: {
              type: "local",
              command: ["tool", "arg"],
              environment: { KEY: "value" },
            },
            remote: { type: "remote", url: "https://example.invalid" },
          },
        }),
  );
  const discovery = new CliHostMcpServers({
    home: "/synthetic",
    environment: {
      CODEX_HOME: "/config/codex",
      XDG_CONFIG_HOME: "/config/xdg",
    },
    read,
  });
  expect(await discovery.servers("codex_cli")).toMatchObject([
    {
      summary: {
        name: "remote",
        transport: "http",
        source: "/config/codex/config.toml",
      },
    },
  ]);
  expect(await discovery.servers("opencode")).toMatchObject([
    { summary: { name: "local", transport: "stdio" } },
    { summary: { name: "remote", transport: "http" } },
  ]);
  expect(await discovery.servers("openai")).toEqual([]);
  expect(await discovery.servers(null)).toEqual([]);
});

it("keeps the first duplicate and tolerates unreadable or invalid configuration", async () => {
  const read = vi.fn(async (file: string) =>
    file.includes("mcp_config")
      ? JSON.stringify({ mcpServers: { shared: { command: "first" } } })
      : JSON.stringify({
          mcpServers: {
            shared: { command: "second" },
            other: { httpUrl: "https://example.invalid" },
          },
        }),
  );
  const discovery = new CliHostMcpServers({
    home: "/synthetic",
    environment: {},
    read,
  });
  expect(await discovery.servers("antigravity")).toMatchObject([
    { server: { command: "first" } },
    { summary: { name: "other", transport: "http" } },
  ]);
  const invalid = new CliHostMcpServers({
    home: "/synthetic",
    environment: {},
    read: async () => "invalid json",
  });
  expect(await invalid.servers("claude_code")).toEqual([]);
  const unavailable = new CliHostMcpServers({
    home: "/synthetic",
    environment: {},
    read: async () => {
      throw new Error("unavailable");
    },
  });
  expect(await unavailable.servers("claude_code")).toEqual([]);
});
