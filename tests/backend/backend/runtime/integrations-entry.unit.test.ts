import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { startIntegrations } from "@/backend/runtime/IntegrationsEntry";
import { shutdownProcess } from "@/backend/runtime/ProcessLifecycle";
import { claimIntegrationProcessing } from "@/backend/service/integrations/IntegrationProcessing";
import { logEvent } from "@/backend/logging/Logger";

vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  installProcessLogging: vi.fn(),
  registerShutdownTask: vi.fn(),
  shutdownProcess: vi.fn(async () => undefined),
}));
vi.mock("@/backend/logging/Logger", () => ({
  initializeLogging: vi.fn(async () => undefined),
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
}));
vi.mock("@/backend/service/integrations/IntegrationProcessing", () => ({
  canProcessIntegrations: vi.fn(),
  claimIntegrationProcessing: vi.fn(async () => false),
  stopIntegrationProcessing: vi.fn(),
}));
vi.mock("@/backend/database/Database", () => ({
  Database: { connect: vi.fn() },
}));
vi.mock("@/backend/service/integrations/IntegrationServices", () => ({
  createIntegrationServices: vi.fn(),
}));
vi.mock("@/backend/service/integrations/IntegrationRunAccess", () => ({
  createIntegrationRunAccess: vi.fn(),
}));
vi.mock("@/backend/service/integrations/IntegrationFcmConsumer", () => ({
  createIntegrationFcmConsumer: vi.fn(),
}));
vi.mock("@/backend/service/integrations/GitHubJobWorker", () => ({
  GitHubJobWorker: vi.fn(),
}));
vi.mock("@/backend/service/events/LiveChangeRelay", () => ({
  forwardLiveChanges: vi.fn(),
}));
vi.mock("@/backend/runtime/ServiceWatchdog", () => ({
  startServiceWatchdog: vi.fn(),
}));

describe("standalone integration startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { argumentsList: [] },
    { argumentsList: ["--config", "relative.toml"] },
    { argumentsList: ["--other", "/config.toml"] },
    { argumentsList: ["--config"] },
  ])(
    "rejects invalid arguments %j before reading configuration",
    async ({ argumentsList }) => {
      const read = vi.spyOn(ConfigFile.prototype, "read");

      await startIntegrations(argumentsList);

      expect(read).not.toHaveBeenCalled();
      expect(shutdownProcess).toHaveBeenCalledWith(1, "integrations_startup");
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "integrations.start.failed",
          level: "fatal",
        }),
      );
      read.mockRestore();
    },
  );

  it("refuses incomplete setup before claiming delivery", async () => {
    const read = vi
      .spyOn(ConfigFile.prototype, "read")
      .mockResolvedValue({ firstRun: true, databasePath: null, port: 4100 });

    await startIntegrations(["--config", "/config.toml"]);

    expect(claimIntegrationProcessing).not.toHaveBeenCalled();
    expect(shutdownProcess).toHaveBeenCalledWith(1, "integrations_startup");
    read.mockRestore();
  });

  it("stops when another process owns delivery", async () => {
    const config = {
      firstRun: false,
      databasePath: "/data/pages.db",
      databaseUrl: "postgres://example.invalid/pages",
      integrationsMode: "separate",
      port: 4100,
    } as const;
    const read = vi
      .spyOn(ConfigFile.prototype, "read")
      .mockResolvedValue(config);

    await startIntegrations(["--config", "/config.toml"]);

    expect(claimIntegrationProcessing).toHaveBeenCalledWith(config, "separate");
    expect(shutdownProcess).toHaveBeenCalledWith(1, "integrations_startup");
    read.mockRestore();
  });
});
