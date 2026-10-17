import { writeFile } from "node:fs/promises";

import { expect, it, vi } from "vitest";

import { AgentToolInstaller } from "@/backend/service/agents/tools/AgentToolInstaller";
import { agentToolDefinition } from "@/backend/service/agents/tools/AgentToolRegistry";

import { toolLocation, toolWorld } from "./page69-tool-world";

import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(async () => undefined),
  symlink: vi.fn(async () => undefined),
  realpath: async (file: string) => file,
}));
vi.mock("node:module", () => ({
  createRequire: () => ({
    resolve: () =>
      "/memory/tools/playwright/node_modules/playwright/package.json",
  }),
}));

function installerWorld(): {
  readonly installer: AgentToolInstaller;
  readonly run: ReturnType<typeof vi.fn<CliProcessRunner["run"]>>;
} {
  if (process.getuid) vi.spyOn(process, "getuid").mockReturnValue(1000);
  const world = toolWorld();
  const run = vi.fn<CliProcessRunner["run"]>(async (request) => ({
    exitCode: 0,
    stdout:
      request.arguments[0] === "-e"
        ? "/memory/tools/chromium/candidate/browsers/chromium/chrome"
        : "",
    stderr: "",
    errorCode: null,
  }));
  return {
    run,
    installer: new AgentToolInstaller({
      files: world.storage,
      locator: {
        locate: async () => ({ found: true, path: "/synthetic/bin/npm" }),
      },
      runner: { run },
      resolve: async () => toolLocation("playwright_mcp"),
    }),
  };
}

it("installs only the pinned registry package with argument arrays and an isolated npm home", async () => {
  const { installer, run } = installerWorld();
  await installer.install(
    agentToolDefinition("codex"),
    toolLocation("codex", "candidate"),
    new AbortController().signal,
  );
  expect(writeFile).toHaveBeenCalledWith(
    "/memory/tools/codex/candidate/package.json",
    expect.stringContaining('"@openai/codex":"0.160.0"'),
    expect.objectContaining({ flag: "wx", mode: 0o600 }),
  );
  expect(run.mock.calls[0]?.[0]).toMatchObject({
    file: "/synthetic/bin/npm",
    arguments: [
      "install",
      "--prefix",
      "/memory/tools/codex/candidate",
      "--registry=https://registry.npmjs.org",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
    ],
    home: { home: "/memory/probe/home" },
    environment: {
      npm_config_userconfig: "/memory/tools/codex/candidate/.npm-user.rc",
      npm_config_globalconfig: "/memory/tools/codex/candidate/.npm-global.rc",
    },
  });
  expect(JSON.stringify(run.mock.calls)).not.toContain("credentials");
});

it("downloads only the package-selected browser revision into its own candidate", async () => {
  const { installer, run } = installerWorld();
  await installer.install(
    agentToolDefinition("chromium"),
    toolLocation("chromium", "candidate"),
    new AbortController().signal,
  );
  expect(run.mock.calls[0]?.[0]).toMatchObject({
    file: process.execPath,
    arguments: [
      "/memory/tools/playwright/node_modules/playwright/cli.js",
      "install",
      "chromium",
    ],
    environment: {
      PLAYWRIGHT_BROWSERS_PATH: "/memory/tools/chromium/candidate/browsers",
    },
  });
  expect(JSON.stringify(run.mock.calls)).not.toContain("install-deps");
});

it("reports install failure without activating a release or removing any login", async () => {
  const { installer, run } = installerWorld();
  run.mockResolvedValueOnce({
    exitCode: 1,
    stdout: "",
    stderr: "synthetic failure",
    errorCode: null,
  });
  await expect(
    installer.install(
      agentToolDefinition("codex"),
      toolLocation("codex", "candidate"),
      new AbortController().signal,
    ),
  ).rejects.toThrow("installation failed");
  expect(run).toHaveBeenCalledOnce();
});

it("refuses root installation instead of changing privileges or host security", async () => {
  const { installer, run } = installerWorld();
  if (process.getuid) vi.spyOn(process, "getuid").mockReturnValue(0);
  await expect(
    installer.install(
      agentToolDefinition("codex"),
      toolLocation("codex"),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ diagnostic: "root_not_allowed" });
  expect(run).not.toHaveBeenCalled();
});
