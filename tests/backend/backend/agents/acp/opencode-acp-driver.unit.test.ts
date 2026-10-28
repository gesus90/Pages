import { expect, it } from "vitest";

import { OPENCODE_ACP_DRIVER } from "@/backend/agents/acp/OpenCodeAcpDriver";
import { SUPPORTED_OPENCODE_VERSION } from "@/backend/agents/cli/OpenCodeVersion";

const MCP = {
  node: "/usr/bin/node",
  bundle: "/pages/mcp.js",
  url: "http://127.0.0.1:3000",
  token: "mcp-token",
  tools: null,
};

function configuration(launch: {
  readonly environment: Readonly<Record<string, string>>;
}): unknown {
  return JSON.parse(launch.environment.OPENCODE_CONFIG_CONTENT);
}

it("refuses a start without an exact model", () => {
  expect(() =>
    OPENCODE_ACP_DRIVER.plan({
      instanceId: "i-1",
      runnerFile: "/bin/opencode",
      profile: OPENCODE_ACP_DRIVER.profile("read_only"),
      mcp: null,
    }),
  ).toThrow(expect.objectContaining({ code: "plan_model_unavailable" }));
});

it("starts a read-only plan node with the Pages MCP server and default variants", () => {
  const launch = OPENCODE_ACP_DRIVER.plan({
    instanceId: "i-1",
    runnerFile: "/bin/opencode",
    profile: OPENCODE_ACP_DRIVER.profile("read_only"),
    model: { model: "zai/glm-5", reasoningEffort: null },
    mcp: MCP,
  });

  expect(launch.environment.PAGES_RUN_INSTANCE).toBe("i-1");
  expect(launch.environment.OPENCODE_SERVER_PASSWORD).toMatch(
    /^[A-Za-z0-9_-]{43}$/u,
  );
  expect(configuration(launch)).toMatchObject({
    enabled_providers: ["zai"],
    default_agent: "pages-read-only",
    autoupdate: false,
    agent: {
      "pages-read-only": { mode: "primary", variant: "default" },
      build: { disable: true },
      plan: { disable: true },
      general: { model: "zai/glm-5", variant: "default" },
      explore: { model: "zai/glm-5", variant: "default" },
      compaction: { model: "zai/glm-5", variant: "default" },
    },
  });
  expect(launch.mcpServers).toEqual([
    expect.objectContaining({ name: "pages", command: "/usr/bin/node" }),
  ]);
  expect(launch.sessionMeta).toEqual({});
});

it("starts Pica with only its bridge and no Pages MCP process", () => {
  const launch = OPENCODE_ACP_DRIVER.plan({
    instanceId: "i-1",
    runnerFile: "/bin/opencode",
    profile: OPENCODE_ACP_DRIVER.profile("read_only", "chat"),
    model: { model: "zai/glm-5", reasoningEffort: "high" },
    mcp: MCP,
    purpose: "chat",
  });
  const content = configuration(launch);

  expect(content).toMatchObject({
    default_agent: "pages-pica",
    permission: { "*": "deny", "pages_*": "allow" },
    agent: { "pages-pica": { variant: "high" } },
  });
  expect(content).not.toHaveProperty("agent.build");
  expect(launch.mcpServers).toEqual([]);
});

it("supports only the verified native OpenCode version", () => {
  expect(
    OPENCODE_ACP_DRIVER.isSupportedAdapter({
      name: "OpenCode",
      version: SUPPORTED_OPENCODE_VERSION,
    }),
  ).toBe(true);
  expect(
    OPENCODE_ACP_DRIVER.isSupportedAdapter({
      name: "OpenCode",
      version: "0.0.1",
    }),
  ).toBe(false);
  expect(
    OPENCODE_ACP_DRIVER.isSupportedAdapter({
      name: "other",
      version: SUPPORTED_OPENCODE_VERSION,
    }),
  ).toBe(false);
  expect(OPENCODE_ACP_DRIVER.isSupportedAdapter(null)).toBe(false);
});
