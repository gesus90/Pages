import { expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "@/backend/config/PagesConfig";
import { ConfigFile } from "@/backend/config/ConfigFile";

import { startAgentTools } from "./AgentToolsStartup";
import { PagesRuntime } from "./PagesRuntime";

import type { MockInstance } from "vitest";

const servicesMock = vi.hoisted(() => ({
  getApplicationServices: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => servicesMock);

interface RuntimeFixture {
  readonly runtime: PagesRuntime;
  readonly initialize: MockInstance<() => Promise<void>>;
}

function createRuntime(isSetupPending: boolean): RuntimeFixture {
  const configFile = new ConfigFile("/unused/config.toml");
  const runtime = new PagesRuntime(
    configFile,
    isSetupPending
      ? { ...DEFAULT_CONFIG }
      : { ...DEFAULT_CONFIG, firstRun: false, databasePath: "/unused/db" },
  );
  const initialize = vi
    .spyOn(runtime.interpreterProfiles, "initialize")
    .mockResolvedValue(undefined);

  return { runtime, initialize };
}

it("initializes interpreter profiles and warms the services after setup", async () => {
  const { runtime, initialize } = createRuntime(false);
  servicesMock.getApplicationServices.mockResolvedValue({});

  await startAgentTools(runtime);

  expect(initialize).toHaveBeenCalledTimes(1);
  expect(servicesMock.getApplicationServices).toHaveBeenCalledTimes(1);
});

it("skips the application services while the setup is pending", async () => {
  const { runtime, initialize } = createRuntime(true);

  await startAgentTools(runtime);

  expect(initialize).toHaveBeenCalledTimes(1);
  expect(servicesMock.getApplicationServices).not.toHaveBeenCalled();
});

it("warns instead of throwing when the interpreter profiles fail", async () => {
  const { runtime, initialize } = createRuntime(false);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  initialize.mockRejectedValue(new Error("profiles broken"));

  await expect(startAgentTools(runtime)).resolves.toBeUndefined();

  expect(servicesMock.getApplicationServices).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(
    "[pages] Agent startup checks could not finish; inspect the Tools page before running agents.",
  );
});

it("warns instead of throwing when the application services fail", async () => {
  const { runtime } = createRuntime(false);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  servicesMock.getApplicationServices.mockRejectedValue(new Error("down"));

  await expect(startAgentTools(runtime)).resolves.toBeUndefined();

  expect(warn).toHaveBeenCalledTimes(1);
});
