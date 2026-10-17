import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  pagesMcpBundlePath,
  PAGES_MCP_VERSION,
} from "@/backend/agents/cli/PagesMcpBundle";

it("resolves the existing operator override without executing the independent MCP package", () => {
  expect(
    pagesMcpBundlePath({ PAGES_MCP_BUNDLE: " /synthetic/pages-mcp.cjs " }),
  ).toBe("/synthetic/pages-mcp.cjs");
});

it("uses the standalone development artifact when no override is given", () => {
  vi.stubEnv("PROD", false);
  expect(pagesMcpBundlePath({})).toBe(
    path.resolve("mcp", "dist", `pages-mcp-v${PAGES_MCP_VERSION}.cjs`),
  );
});
