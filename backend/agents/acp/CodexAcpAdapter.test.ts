import { expect, it } from "vitest";

import {
  isSupportedCodexAcp,
  planCodexAcpLaunch,
} from "@/backend/agents/acp/CodexAcpAdapter";
import { codexAcpProfile } from "@/backend/agents/acp/CodexAcpProfile";

it("accepts a stable adapter release from the minimum on", () => {
  const name = "@agentclientprotocol/codex-acp";
  expect(isSupportedCodexAcp({ name, version: "2.1.1" })).toBe(true);
  expect(isSupportedCodexAcp({ name, version: "2.1.0" })).toBe(false);
  expect(isSupportedCodexAcp({ name: "other", version: "3.0.0" })).toBe(false);
  expect(isSupportedCodexAcp(undefined)).toBe(false);
});

it("starts the adapter with the configuration of the profile", () => {
  const profile = codexAcpProfile("read_only");
  const launch = planCodexAcpLaunch({
    instanceId: "instance-1",
    runnerFile: "/bin/codex",
    profile,
    mcp: { url: "https://pages.example/", token: "secret", tools: null },
  });
  expect(launch.environment.CODEX_PATH).toBe("/bin/codex");
  expect(launch.environment.INITIAL_AGENT_MODE).toBe("read-only");
  expect(JSON.parse(launch.environment.CODEX_CONFIG)).toEqual(
    profile.configuration,
  );
  expect(launch.mcpServers).toHaveLength(1);
  expect(launch.sessionMeta).toEqual({ mcpStartupAwaitTimeoutMs: 30_000 });
});
