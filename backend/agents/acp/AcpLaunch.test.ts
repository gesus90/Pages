import { expect, it } from "vitest";

import {
  PAGES_MCP_SERVER,
  pagesMcpServers,
  planBridgeUrl,
  requireAcpMcpCapabilities,
} from "@/backend/agents/acp/AcpLaunch";
import { AgentError } from "@/backend/error/AgentErrors";

import type { McpServer } from "@agentclientprotocol/sdk";
import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";

const MCP = {
  url: "https://pages.test/",
  token: "tok",
  tools: null,
} as unknown as CliSessionMcp;
const HTTP: McpServer = { type: "http", name: "h", url: "u", headers: [] };
const STDIO: McpServer = { name: "s", command: "c", args: [], env: [] };

it("accepts servers whose transport is negotiated", () => {
  expect(() =>
    requireAcpMcpCapabilities([STDIO, HTTP], { http: true }),
  ).not.toThrow();
});

it.each([undefined, null, {}, { http: false }])(
  "refuses http without capability %#",
  (capabilities) => {
    expect(() => requireAcpMcpCapabilities([HTTP], capabilities)).toThrow(
      AgentError,
    );
  },
);

it("builds the bridge url without a trailing slash", () => {
  expect(planBridgeUrl(MCP)).toBe("https://pages.test/api/v1/plan-bridge");
});

it("offers no server without access", () => {
  expect(pagesMcpServers(null)).toEqual([]);
});

it("offers the Pages server with credential", () => {
  const [server] = pagesMcpServers(MCP);
  expect(server).toMatchObject({ type: "http", name: PAGES_MCP_SERVER });
  expect(JSON.stringify(server)).toContain("Bearer tok");
});
