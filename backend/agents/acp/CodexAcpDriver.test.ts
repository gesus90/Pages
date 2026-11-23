import { beforeEach, expect, it, vi } from "vitest";

import { CODEX_ACP_DRIVER } from "@/backend/agents/acp/CodexAcpDriver";
import { codexAcpProfile } from "@/backend/agents/acp/CodexAcpProfile";
import { findUnmanagedCodexConfiguration } from "@/backend/agents/acp/CodexAcpConfigurationGuard";
import { logDiagnostic } from "@/backend/logging/Logger";

import type { CliHome } from "@/backend/agents/cli/CliContracts";

vi.mock("@/backend/agents/acp/CodexAcpConfigurationGuard", () => ({
  findUnmanagedCodexConfiguration: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({ logDiagnostic: vi.fn() }));

const HOME: CliHome = {
  root: "/home",
  home: "/home/home",
  config: "/home/config",
  work: "/home/work",
};

beforeEach(() => {
  vi.mocked(findUnmanagedCodexConfiguration).mockReset();
  vi.mocked(logDiagnostic).mockReset();
});

it("plans a launch with the profile of the requested mode", () => {
  const launch = CODEX_ACP_DRIVER.plan({
    instanceId: "instance-1",
    runnerFile: "/bin/codex",
    profile: codexAcpProfile("yolo"),
    mcp: null,
  });
  expect(launch.environment.INITIAL_AGENT_MODE).toBe("agent-full-access");
});

it("accepts a directory without an unmanaged configuration", async () => {
  vi.mocked(findUnmanagedCodexConfiguration).mockResolvedValue(null);
  await expect(
    CODEX_ACP_DRIVER.requireManagedConfiguration(HOME, "/dir"),
  ).resolves.toBeUndefined();
  expect(findUnmanagedCodexConfiguration).toHaveBeenCalledWith(
    "/home/config",
    "/dir",
  );
  expect(logDiagnostic).not.toHaveBeenCalled();
});

it("refuses a start because of an unmanaged configuration file", async () => {
  vi.mocked(findUnmanagedCodexConfiguration).mockResolvedValue("/dir/x.toml");
  await expect(
    CODEX_ACP_DRIVER.requireManagedConfiguration(HOME, "/dir"),
  ).rejects.toMatchObject({ code: "plan_codex_configuration_unmanaged" });
  expect(logDiagnostic).toHaveBeenCalledWith(
    "CodexAcpDriver",
    "warn",
    expect.stringContaining("/dir/x.toml"),
  );
});
