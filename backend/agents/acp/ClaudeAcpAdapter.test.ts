import { expect, it } from "vitest";

import {
  isSupportedClaudeAcp,
  planClaudeAcpLaunch,
} from "@/backend/agents/acp/ClaudeAcpAdapter";
import { claudeAcpProfile } from "@/backend/agents/acp/ClaudeAcpProfile";

import type { AcpSessionPurpose } from "@/backend/agents/acp/AcpDriver";

const PACKAGE = "@agentclientprotocol/claude-agent-acp";

it("accepts a stable adapter release from the minimum on", () => {
  expect(isSupportedClaudeAcp({ name: PACKAGE, version: "0.90.0" })).toBe(true);
  expect(isSupportedClaudeAcp({ name: PACKAGE, version: "0.89.9" })).toBe(
    false,
  );
  expect(isSupportedClaudeAcp({ name: "other", version: "1.0.0" })).toBe(false);
  expect(isSupportedClaudeAcp(null)).toBe(false);
});

function specification(
  purpose: AcpSessionPurpose | undefined,
  mode: "read_only" | "yolo",
  extra: object = {},
): Parameters<typeof planClaudeAcpLaunch>[0] {
  return {
    instanceId: "instance-1",
    runnerFile: "/bin/claude",
    profile: claudeAcpProfile(mode, purpose),
    mcp: null,
    purpose,
    ...extra,
  };
}

it("starts a plan node with raw message events and no output limit", () => {
  const launch = planClaudeAcpLaunch(specification(undefined, "yolo"));
  expect(launch.environment.CLAUDE_CODE_EXECUTABLE).toBe("/bin/claude");
  expect(launch.environment.BASH_MAX_OUTPUT_LENGTH).toBeUndefined();
  expect(launch.mcpServers).toEqual([]);
  expect(launch.sessionMeta).toMatchObject({
    claudeCode: {
      emitRawSDKMessages: [{ type: "assistant" }, { type: "result" }],
    },
  });
});

it("starts a read-only chat with the selected model and effort", () => {
  const launch = planClaudeAcpLaunch(
    specification("chat", "read_only", {
      model: { model: "sonnet", reasoningEffort: "high" },
    }),
  );
  expect(launch.environment.BASH_MAX_OUTPUT_LENGTH).toBe("131072");
  const meta = launch.sessionMeta as {
    claudeCode: {
      options: Record<string, unknown>;
      emitRawSDKMessages?: unknown;
    };
  };
  expect(meta.claudeCode.options).toMatchObject({
    model: "sonnet",
    effort: "high",
  });
  expect(meta.claudeCode.emitRawSDKMessages).toBeUndefined();
});

it("leaves the effort out when the model has none", () => {
  const launch = planClaudeAcpLaunch(
    specification("chat", "read_only", {
      model: { model: "haiku", reasoningEffort: null },
    }),
  );
  const meta = launch.sessionMeta as {
    claudeCode: { options: Record<string, unknown> };
  };
  expect(meta.claudeCode.options.model).toBe("haiku");
  expect("effort" in meta.claudeCode.options).toBe(false);
});

it("keeps the profile options for a yolo chat", () => {
  const profile = claudeAcpProfile("yolo", "chat");
  const launch = planClaudeAcpLaunch(
    specification("chat", "yolo", {
      model: { model: "sonnet", reasoningEffort: null },
    }),
  );
  expect(launch.sessionMeta).toEqual({
    claudeCode: { options: profile.options },
  });
});
