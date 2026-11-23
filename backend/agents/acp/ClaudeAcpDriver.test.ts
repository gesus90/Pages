import { expect, it } from "vitest";

import { CLAUDE_ACP_DRIVER } from "@/backend/agents/acp/ClaudeAcpDriver";
import { claudeAcpProfile } from "@/backend/agents/acp/ClaudeAcpProfile";

import type { CliHome } from "@/backend/agents/cli/CliContracts";

it("names the Claude adapter and its steering option", () => {
  expect(CLAUDE_ACP_DRIVER.provider).toBe("claude_code");
  expect(CLAUDE_ACP_DRIVER.supportedVersions).toBe("0.90.0 or later");
  expect(CLAUDE_ACP_DRIVER.steeringMeta).toEqual({
    steering: { idleBehavior: "promptRequired" },
  });
});

it("plans a launch with the profile of the requested mode", () => {
  const launch = CLAUDE_ACP_DRIVER.plan({
    instanceId: "instance-1",
    runnerFile: "/bin/claude",
    profile: claudeAcpProfile("yolo"),
    mcp: null,
  });
  expect(launch.environment.CLAUDE_CODE_EXECUTABLE).toBe("/bin/claude");
});

it("has no configuration file to refuse", async () => {
  const home: CliHome = {
    root: "/c",
    home: "/c/home",
    config: "/c/config",
    work: "/c/work",
  };
  await expect(
    CLAUDE_ACP_DRIVER.requireManagedConfiguration(home, "/dir"),
  ).resolves.toBeUndefined();
});
