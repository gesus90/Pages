import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapConfig } from "@/backend/config/ConfigBootstrap";
import { ConfigError } from "@/backend/config/PagesConfig";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { createLegacyDatabaseWarning } from "@/backend/database/DatabasePath";
import {
  getPagesRuntime,
  initializePagesRuntime,
  PagesRuntime,
  RuntimeNotInitializedError,
  SetupPendingError,
} from "@/backend/runtime/PagesRuntime";

import type {
  CompletedSetupConfig,
  PagesConfig,
  PendingSetupConfig,
} from "@/backend/config/PagesConfig";

vi.mock("@/backend/config/ConfigBootstrap", () => ({
  bootstrapConfig: vi.fn(),
}));
vi.mock("@/backend/database/DatabasePath", () => ({
  createLegacyDatabaseWarning: vi.fn(),
}));

const CONFIG_PATH = "/srv/pages/config.toml";
const PENDING: PendingSetupConfig = {
  databasePath: null,
  firstRun: true,
  port: 3000,
};
const COMPLETED: CompletedSetupConfig = {
  databasePath: "/srv/pages/data/pages.duckdb",
  firstRun: false,
  port: 3000,
};

function runtimeOf(config: PagesConfig): PagesRuntime {
  return new PagesRuntime(new ConfigFile(CONFIG_PATH), config);
}

beforeEach(() => {
  globalThis.pagesRuntime = undefined;
});

afterEach(() => {
  globalThis.pagesRuntime = undefined;
  vi.mocked(bootstrapConfig).mockReset();
  vi.mocked(createLegacyDatabaseWarning).mockReset();
});

describe("a runtime with a pending setup", () => {
  it("reports the pending setup and keeps the token secret to the console", () => {
    const runtime = runtimeOf(PENDING);

    expect(runtime.isSetupPending()).toBe(true);
    expect(runtime.getSetupToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("accepts only its own token", () => {
    const runtime = runtimeOf(PENDING);
    const token = runtime.getSetupToken() ?? "";

    expect(runtime.verifySetupToken(token)).toBe(true);
    expect(runtime.verifySetupToken(`${token}x`)).toBe(false);
    expect(runtime.verifySetupToken(token.slice(1))).toBe(false);
    expect(runtime.verifySetupToken("")).toBe(false);
    expect(runtime.verifySetupToken(null)).toBe(false);
    expect(runtime.verifySetupToken(undefined)).toBe(false);
    expect(runtime.verifySetupToken(12)).toBe(false);
  });

  it("issues a different token for every start", () => {
    expect(runtimeOf(PENDING).getSetupToken()).not.toBe(
      runtimeOf(PENDING).getSetupToken(),
    );
  });

  it("does not accept the token of another runtime", () => {
    const first = runtimeOf(PENDING);
    const second = runtimeOf(PENDING);

    expect(second.verifySetupToken(first.getSetupToken())).toBe(false);
  });

  it("suggests the default database next to the configuration", () => {
    expect(runtimeOf(PENDING).getSuggestedDatabasePath()).toBe(
      "/srv/pages/data/pages.duckdb",
    );
  });

  it("suggests the database of a reset instance", () => {
    const runtime = runtimeOf({
      databasePath: "/mnt/old/pages.duckdb",
      firstRun: true,
      port: 3000,
    });

    expect(runtime.getSuggestedDatabasePath()).toBe("/mnt/old/pages.duckdb");
  });

  it("refuses to hand out the database", () => {
    expect(() => runtimeOf(PENDING).getDatabasePath()).toThrow(
      SetupPendingError,
    );
  });

  it("exposes the configuration file and the stored configuration", () => {
    const runtime = runtimeOf(PENDING);

    expect(runtime.configFile.path).toBe(CONFIG_PATH);
    expect(runtime.getConfig()).toBe(PENDING);
  });
});

describe("a runtime with a finished setup", () => {
  it("has no token and accepts no candidate", () => {
    const runtime = runtimeOf(COMPLETED);

    expect(runtime.isSetupPending()).toBe(false);
    expect(runtime.getSetupToken()).toBeNull();
    expect(runtime.verifySetupToken("anything")).toBe(false);
  });

  it("returns the database of the setup", () => {
    const runtime = runtimeOf(COMPLETED);

    expect(runtime.getDatabasePath()).toBe(COMPLETED.databasePath);
    expect(runtime.getSuggestedDatabasePath()).toBe(COMPLETED.databasePath);
  });
});

describe("finishSetup", () => {
  it("switches to normal operation and drops the token", () => {
    const runtime = runtimeOf(PENDING);
    const token = runtime.getSetupToken() ?? "";

    runtime.finishSetup(COMPLETED);

    expect(runtime.isSetupPending()).toBe(false);
    expect(runtime.getSetupToken()).toBeNull();
    expect(runtime.verifySetupToken(token)).toBe(false);
    expect(runtime.getConfig()).toBe(COMPLETED);
    expect(runtime.getDatabasePath()).toBe(COMPLETED.databasePath);
  });
});

describe("runExclusiveSetup", () => {
  it("runs overlapping completions one after another", async () => {
    const runtime = runtimeOf(PENDING);
    const events: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = runtime.runExclusiveSetup(async () => {
      events.push("first start");
      await gate;
      events.push("first end");

      return 1;
    });
    const second = runtime.runExclusiveSetup(async () => {
      events.push("second start");

      return 2;
    });
    await Promise.resolve();
    expect(events).toEqual(["first start"]);
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first start", "first end", "second start"]);
  });

  it("runs the next completion after a failed one", async () => {
    const runtime = runtimeOf(PENDING);
    const failed = runtime.runExclusiveSetup(async () => {
      throw new Error("The first attempt failed.");
    });

    await expect(failed).rejects.toThrow("first attempt failed");
    await expect(runtime.runExclusiveSetup(async () => "second")).resolves.toBe(
      "second",
    );
  });
});

describe("the process runtime", () => {
  it("refuses requests before the server initialized it", async () => {
    await expect(getPagesRuntime()).rejects.toBeInstanceOf(
      RuntimeNotInitializedError,
    );
  });

  it("creates the runtime from the bootstrapped configuration", async () => {
    vi.mocked(bootstrapConfig).mockResolvedValue({
      config: COMPLETED,
      isNewConfig: false,
    });

    const runtime = await initializePagesRuntime(CONFIG_PATH);

    expect(runtime.configFile.path).toBe(CONFIG_PATH);
    expect(runtime.getConfig()).toBe(COMPLETED);
    await expect(getPagesRuntime()).resolves.toBe(runtime);
  });

  it("creates only one runtime however often it is initialized", async () => {
    vi.mocked(bootstrapConfig).mockResolvedValue({
      config: COMPLETED,
      isNewConfig: false,
    });

    const [first, second] = await Promise.all([
      initializePagesRuntime(CONFIG_PATH),
      initializePagesRuntime("/other/config.toml"),
    ]);

    expect(second).toBe(first);
    expect(bootstrapConfig).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed start so a corrected file can be retried", async () => {
    vi.mocked(bootstrapConfig).mockRejectedValueOnce(
      new ConfigError("The configuration is broken."),
    );

    await expect(initializePagesRuntime(CONFIG_PATH)).rejects.toThrow(
      "configuration is broken",
    );
    await expect(getPagesRuntime()).rejects.toBeInstanceOf(
      RuntimeNotInitializedError,
    );
    vi.mocked(bootstrapConfig).mockResolvedValue({
      config: PENDING,
      isNewConfig: true,
    });

    const runtime = await initializePagesRuntime(CONFIG_PATH);

    expect(runtime.isSetupPending()).toBe(true);
  });
});

describe("legacy database warning", () => {
  it("warns the operator while the setup is pending", async () => {
    const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);
    vi.mocked(bootstrapConfig).mockResolvedValue({
      config: PENDING,
      isNewConfig: true,
    });
    vi.mocked(createLegacyDatabaseWarning).mockReturnValue("Found pages.db");

    await initializePagesRuntime(CONFIG_PATH);

    expect(createLegacyDatabaseWarning).toHaveBeenCalledWith(
      "/srv/pages/data/pages.duckdb",
    );
    expect(warn).toHaveBeenCalledWith("Found pages.db");
  });

  it("stays quiet when nothing was left behind", async () => {
    const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);
    vi.mocked(bootstrapConfig).mockResolvedValue({
      config: PENDING,
      isNewConfig: true,
    });
    vi.mocked(createLegacyDatabaseWarning).mockReturnValue(null);

    await initializePagesRuntime(CONFIG_PATH);

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not look for a legacy file after the setup finished", async () => {
    vi.mocked(bootstrapConfig).mockResolvedValue({
      config: COMPLETED,
      isNewConfig: false,
    });

    await initializePagesRuntime(CONFIG_PATH);

    expect(createLegacyDatabaseWarning).not.toHaveBeenCalled();
  });
});
