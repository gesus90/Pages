import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { ConfigError } from "@/backend/config/PagesConfig";
import {
  getPagesRuntime,
  initializePagesRuntime,
  PagesRuntime,
  RuntimeNotInitializedError,
  SetupPendingError,
} from "@/backend/runtime/PagesRuntime";

describe("PagesRuntime", () => {
  const configFile = new ConfigFile("/srv/pages/config.toml");

  it("issues a setup token while the setup is pending", () => {
    const runtime = new PagesRuntime(configFile, {
      databasePath: null,
      firstRun: true,
      port: 3000,
    });
    const token = runtime.getSetupToken();

    expect(runtime.isSetupPending()).toBe(true);
    expect(runtime.configFile).toBe(configFile);
    expect(token).not.toBeNull();
    expect(runtime.verifySetupToken(token)).toBe(true);
    expect(runtime.verifySetupToken("guess")).toBe(false);
    expect(runtime.getSuggestedDatabasePath()).toBe(
      "/srv/pages/data/pages.duckdb",
    );
    expect(() => runtime.getDatabasePath()).toThrow(SetupPendingError);
  });

  it("suggests the database of a reset instance", () => {
    const runtime = new PagesRuntime(configFile, {
      databasePath: "/data/old.duckdb",
      firstRun: true,
      port: 3000,
    });

    expect(runtime.getSuggestedDatabasePath()).toBe("/data/old.duckdb");
  });

  it("has no token once the setup finished", () => {
    const runtime = new PagesRuntime(configFile, {
      databasePath: null,
      firstRun: true,
      port: 3000,
    });
    const token = runtime.getSetupToken();
    const config = {
      databasePath: "/data/pages.duckdb",
      firstRun: false,
      port: 3000,
    } as const;

    runtime.finishSetup(config);

    expect(runtime.isSetupPending()).toBe(false);
    expect(runtime.getSetupToken()).toBeNull();
    expect(runtime.verifySetupToken(token)).toBe(false);
    expect(runtime.getConfig()).toBe(config);
    expect(runtime.getDatabasePath()).toBe("/data/pages.duckdb");
  });

  it("runs setup work one at a time", async () => {
    const runtime = new PagesRuntime(configFile, {
      databasePath: "/data/pages.duckdb",
      firstRun: false,
      port: 3000,
    });
    const order: string[] = [];
    let release: () => void = () => {};
    const first = runtime.runExclusiveSetup(async () => {
      order.push("first started");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push("first finished");
    });
    const second = runtime.runExclusiveSetup(async () => {
      order.push("second started");
    });

    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(order).toEqual([
      "first started",
      "first finished",
      "second started",
    ]);
  });
});

describe("runtime initialization", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-runtime-"));
    globalThis.pagesRuntime = undefined;
  });

  afterEach(async () => {
    globalThis.pagesRuntime = undefined;
    vi.restoreAllMocks();
    await rm(directory, { force: true, recursive: true });
  });

  it("refuses access before the server initialized it", async () => {
    await expect(getPagesRuntime()).rejects.toThrow(RuntimeNotInitializedError);
  });

  it("creates the runtime once and warns about a former SQLite database", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const configPath = path.join(directory, "config.toml");

    await mkdir(path.join(directory, "data"));
    await writeFile(path.join(directory, "data", "pages.db"), "");

    const runtime = await initializePagesRuntime(configPath);

    expect(await initializePagesRuntime("/ignored.toml")).toBe(runtime);
    expect(await getPagesRuntime()).toBe(runtime);
    expect(runtime.isSetupPending()).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pages.db"));
  });

  it("stays quiet without a former database and for finished setups", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const databasePath = path.join(directory, "pages.duckdb");
    const configPath = path.join(directory, "config.toml");

    await writeFile(databasePath, "");
    await new ConfigFile(configPath).write({
      databasePath,
      firstRun: false,
      port: 3000,
    });

    const runtime = await initializePagesRuntime(configPath);

    expect(runtime.isSetupPending()).toBe(false);
    globalThis.pagesRuntime = undefined;
    await rm(configPath);
    await initializePagesRuntime(configPath);
    expect(warn).not.toHaveBeenCalled();
  });

  it("allows a retry after a failed start", async () => {
    const configPath = path.join(directory, "config.toml");

    await writeFile(configPath, "port = 0\n");

    await expect(initializePagesRuntime(configPath)).rejects.toThrow(
      ConfigError,
    );
    expect(globalThis.pagesRuntime).toBeUndefined();

    await writeFile(configPath, "port = 4000\n");

    await expect(initializePagesRuntime(configPath)).resolves.toBeInstanceOf(
      PagesRuntime,
    );
  });
});
