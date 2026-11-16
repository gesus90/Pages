import { expect, it, vi } from "vitest";

import { createAgentToolManager } from "@/backend/service/agents/tools/AgentToolServices";
import { agentToolDefinition } from "@/backend/service/agents/tools/AgentToolRegistry";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { AgentToolDefinition } from "@/backend/service/agents/tools/AgentToolRegistry";
import type { AgentToolLocation } from "@/backend/service/agents/tools/AgentToolContracts";

const boundary = vi.hoisted(() => ({
  capture: vi.fn(),
  current: vi.fn(),
  realpath: vi.fn(async (file: string) => file),
  access: vi.fn(async () => undefined),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<object>()),
  realpath: boundary.realpath,
  access: boundary.access,
}));
vi.mock("@/backend/service/agents/tools/AgentToolFiles", () => ({
  AgentToolFiles: class {
    public root = "/instance/tools";
    public current = boundary.current;
  },
}));
vi.mock("@/backend/service/agents/tools/AgentToolManagerService", () => ({
  AgentToolManagerService: class {
    public constructor(input: unknown) {
      boundary.capture(input);
    }
  },
}));
vi.mock("@/backend/service/agents/tools/AgentToolInstaller", () => ({
  AgentToolInstaller: class {},
}));
vi.mock("@/backend/service/agents/tools/AgentToolHealthService", () => ({
  AgentToolHealthService: class {},
}));

it("selects node, refuses browser discovery and accepts trusted system executables", async () => {
  const locate = vi
    .fn<CliLocator["locate"]>()
    .mockResolvedValue(partial({ path: "/usr/bin/codex" }));
  createAgentToolManager({
    instanceDirectory: "/instance",
    locator: partial({ locate }),
    runner: partial<CliProcessRunner>({ toolActivities: vi.fn(() => []) }),
  });
  const options = partial<{
    system: (tool: AgentToolDefinition) => Promise<AgentToolLocation | null>;
  }>(boundary.capture.mock.calls.at(-1)?.[0]);
  await expect(
    options.system(agentToolDefinition("node")),
  ).resolves.toMatchObject({ file: process.execPath, source: "system" });
  await expect(
    options.system(agentToolDefinition("chromium")),
  ).resolves.toBeNull();
  await expect(
    options.system(agentToolDefinition("codex")),
  ).resolves.toMatchObject({ file: "/usr/bin/codex", source: "system" });
  expect(locate).toHaveBeenCalledOnce();
});

it("rejects an executable resolved inside the user's home outside the Node installation", async () => {
  const locate = vi
    .fn<CliLocator["locate"]>()
    .mockResolvedValue(
      partial({ path: `${process.env.HOME}/untrusted/codex` }),
    );
  createAgentToolManager({
    instanceDirectory: "/instance",
    locator: partial({ locate }),
    runner: partial({ toolActivities: vi.fn(() => []) }),
  });
  const options = partial<{
    system: (tool: AgentToolDefinition) => Promise<AgentToolLocation | null>;
  }>(boundary.capture.mock.calls.at(-1)?.[0]);
  await expect(
    options.system(agentToolDefinition("codex")),
  ).resolves.toBeNull();
});
