import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError, DEFAULT_CONFIG } from "@/backend/config/PagesConfig";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { DEFAULT_LOG_RETENTION_DAYS } from "@/definition/Logging";

import {
  getPagesRuntime,
  initializePagesRuntime,
  PagesRuntime,
  RuntimeNotInitializedError,
  SetupPendingError,
} from "./PagesRuntime";

import type {
  CompletedSetupConfig,
  PagesConfig,
} from "@/backend/config/PagesConfig";

const mocks = vi.hoisted(() => ({
  bootstrapConfig: vi.fn(),
  registerLogSecret: vi.fn(),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
  updateLogRetention: vi.fn(),
  isLocalSessionOwner: vi.fn(),
  isPagesRunsProcess: vi.fn(),
  refresh: vi.fn(),
  openRouterPriceCatalog: vi.fn(),
}));

vi.mock("@/backend/config/ConfigBootstrap", () => ({
  bootstrapConfig: mocks.bootstrapConfig,
}));
vi.mock("@/backend/logging/LogRedaction", () => ({
  registerLogSecret: mocks.registerLogSecret,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logEvent: mocks.logEvent,
  updateLogRetention: mocks.updateLogRetention,
}));
vi.mock("@/backend/agents/local/LocalSessionMode", () => ({
  isLocalSessionOwner: mocks.isLocalSessionOwner,
}));
vi.mock("./RunsMode", () => ({
  isPagesRunsProcess: mocks.isPagesRunsProcess,
}));
vi.mock("@/backend/service/agents/sessions/OpenRouterPriceCatalog", () => ({
  openRouterPriceCatalog: mocks.openRouterPriceCatalog,
}));

const DAY_MS = 86_400_000;

const completedConfig: CompletedSetupConfig = {
  ...DEFAULT_CONFIG,
  firstRun: false,
  databasePath: "/data/pages.db",
  databaseUrl: "postgres://pages@localhost/pages",
};

function createRuntime(config: PagesConfig): PagesRuntime {
  return new PagesRuntime(new ConfigFile("/data/config.toml"), config);
}

beforeEach(() => {
  globalThis.pagesRuntime = undefined;
  mocks.openRouterPriceCatalog.mockReturnValue({ refresh: mocks.refresh });
  mocks.refresh.mockResolvedValue(undefined);
  mocks.updateLogRetention.mockResolvedValue(undefined);
  mocks.isLocalSessionOwner.mockReturnValue(false);
  mocks.isPagesRunsProcess.mockReturnValue(false);
});

afterEach(() => {
  globalThis.pagesRuntime = undefined;
  vi.useRealTimers();
});

describe("PagesRuntime during a pending setup", () => {
  it("issues a setup token, registers it as a log secret and verifies it", () => {
    const runtime = createRuntime({ ...DEFAULT_CONFIG });
    const token = runtime.getSetupToken();

    expect(token).toEqual(expect.any(String));
    expect(runtime.isSetupPending()).toBe(true);
    expect(mocks.registerLogSecret).toHaveBeenCalledWith(token);
    expect(runtime.verifySetupToken(token)).toBe(true);
    expect(runtime.verifySetupToken("wrong")).toBe(false);
    expect(runtime.verifySetupToken(42)).toBe(false);
  });

  it("refuses the database path and URL while the setup is pending", () => {
    const runtime = createRuntime({ ...DEFAULT_CONFIG });

    expect(() => runtime.getDatabasePath()).toThrow(SetupPendingError);
    expect(runtime.getDatabaseUrl()).toBeNull();
  });

  it("suggests the default database path next to the configuration file", () => {
    const runtime = createRuntime({ ...DEFAULT_CONFIG });

    expect(runtime.getSuggestedDatabasePath()).toBe("/data/data/pages.duckdb");
  });

  it("suggests the stored database path of a reset instance", () => {
    const runtime = createRuntime({
      ...DEFAULT_CONFIG,
      databasePath: "/old/pages.db",
    });

    expect(runtime.getSuggestedDatabasePath()).toBe("/old/pages.db");
  });

  it("keeps the setup token when setup configuration is only staged", () => {
    const runtime = createRuntime({ ...DEFAULT_CONFIG });
    const token = runtime.getSetupToken();

    runtime.stageSetup({ ...DEFAULT_CONFIG, port: 4000 });

    expect(runtime.getConfig().port).toBe(4000);
    expect(runtime.getSetupToken()).toBe(token);
  });

  it("discards the token when the setup finishes", () => {
    const runtime = createRuntime({ ...DEFAULT_CONFIG });
    const token = runtime.getSetupToken();

    runtime.finishSetup(completedConfig);

    expect(runtime.isSetupPending()).toBe(false);
    expect(runtime.getSetupToken()).toBeNull();
    expect(runtime.verifySetupToken(token)).toBe(false);
    expect(runtime.getConfig()).toBe(completedConfig);
  });

  it("runs exclusive setup work and returns its result", async () => {
    const runtime = createRuntime({ ...DEFAULT_CONFIG });
    const order: string[] = [];
    const first = runtime.runExclusiveSetup(async () => {
      order.push("first");
      return 1;
    });
    const second = runtime.runExclusiveSetup(async () => {
      order.push("second");
      return 2;
    });

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["first", "second"]);
  });
});

describe("PagesRuntime after a finished setup", () => {
  it("issues no token and registers only the core secret", () => {
    const runtime = createRuntime({
      ...completedConfig,
      pagesCoreSecret: "core-secret",
    });

    expect(runtime.getSetupToken()).toBeNull();
    expect(runtime.isSetupPending()).toBe(false);
    expect(runtime.verifySetupToken("anything")).toBe(false);
    expect(mocks.registerLogSecret).toHaveBeenCalledTimes(1);
    expect(mocks.registerLogSecret).toHaveBeenCalledWith("core-secret");
  });

  it("registers no secret when none exists", () => {
    createRuntime(completedConfig);

    expect(mocks.registerLogSecret).not.toHaveBeenCalled();
  });

  it("exposes database path, URL, file and configuration", () => {
    const file = new ConfigFile("/data/config.toml");
    const runtime = new PagesRuntime(file, completedConfig);

    expect(runtime.getDatabasePath()).toBe("/data/pages.db");
    expect(runtime.getDatabaseUrl()).toBe("postgres://pages@localhost/pages");
    expect(runtime.configFile).toBe(file);
    expect(runtime.getConfig()).toBe(completedConfig);
    expect(runtime.getSuggestedDatabasePath()).toBe("/data/pages.db");
  });

  it("reports no database URL when none is configured", () => {
    const runtime = createRuntime({
      ...completedConfig,
      databaseUrl: undefined,
    });

    expect(runtime.getDatabaseUrl()).toBeNull();
  });
});

describe("runtime errors", () => {
  it("names the errors for callers", () => {
    expect(new SetupPendingError().name).toBe("SetupPendingError");
    expect(new RuntimeNotInitializedError().name).toBe(
      "RuntimeNotInitializedError",
    );
  });
});

describe("initializePagesRuntime", () => {
  it("bootstraps once, applies the configured retention and refreshes prices daily", async () => {
    vi.useFakeTimers();
    mocks.bootstrapConfig.mockResolvedValue({
      config: { ...completedConfig, logRetentionDays: 7 },
    });

    const first = await initializePagesRuntime("/data/config.toml");
    const second = await initializePagesRuntime("/other/config.toml");

    expect(second).toBe(first);
    expect(mocks.bootstrapConfig).toHaveBeenCalledTimes(1);
    expect(mocks.updateLogRetention).toHaveBeenCalledWith(7, "startup");
    expect(mocks.openRouterPriceCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.openRouterPriceCatalog).toHaveBeenCalledWith("/data/data");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DAY_MS);

    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    await expect(getPagesRuntime()).resolves.toBe(first);
  });

  it("falls back to the default retention when none is configured", async () => {
    mocks.bootstrapConfig.mockResolvedValue({ config: completedConfig });
    vi.useFakeTimers();

    await initializePagesRuntime("/data/config.toml");

    expect(mocks.updateLogRetention).toHaveBeenCalledWith(
      DEFAULT_LOG_RETENTION_DAYS,
      "startup",
    );
  });

  it.each([
    ["a local session owner", true, false],
    ["a runs process", false, true],
  ])("does not refresh prices in %s", async (description, isOwner, isRuns) => {
    mocks.isLocalSessionOwner.mockReturnValue(isOwner);
    mocks.isPagesRunsProcess.mockReturnValue(isRuns);
    mocks.bootstrapConfig.mockResolvedValue({ config: completedConfig });

    await initializePagesRuntime("/data/config.toml");

    expect(mocks.openRouterPriceCatalog).not.toHaveBeenCalled();
  });

  it("forgets a failed start so a corrected configuration can be retried", async () => {
    const failure = new ConfigError("broken");
    mocks.bootstrapConfig.mockRejectedValueOnce(failure);

    await expect(initializePagesRuntime("/data/config.toml")).rejects.toBe(
      failure,
    );

    expect(mocks.logCaughtError).toHaveBeenCalledWith("PagesRuntime", failure);
    expect(globalThis.pagesRuntime).toBeUndefined();

    mocks.bootstrapConfig.mockResolvedValue({ config: completedConfig });
    vi.useFakeTimers();

    await expect(
      initializePagesRuntime("/data/config.toml"),
    ).resolves.toBeInstanceOf(PagesRuntime);
  });
});

describe("getPagesRuntime", () => {
  it("rejects before the runtime was initialized", async () => {
    await expect(getPagesRuntime()).rejects.toBeInstanceOf(
      RuntimeNotInitializedError,
    );
  });
});
