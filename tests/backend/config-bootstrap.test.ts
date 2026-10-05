import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bootstrapConfig } from "@/backend/config/ConfigBootstrap";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { ConfigError, DEFAULT_CONFIG } from "@/backend/config/PagesConfig";

import { createPagesDatabaseFile } from "../helpers/pages-database-file";

describe("bootstrapConfig", () => {
  let directory: string;
  let configFile: ConfigFile;
  let dataDirectory: string;
  let defaultDatabase: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-bootstrap-"));
    configFile = new ConfigFile(path.join(directory, "config.toml"));
    dataDirectory = path.join(directory, "data");
    defaultDatabase = path.join(dataDirectory, "pages.duckdb");
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it("writes the default configuration and an empty data directory", async () => {
    await expect(bootstrapConfig(configFile)).resolves.toEqual({
      config: DEFAULT_CONFIG,
      isNewConfig: true,
    });
    await expect(configFile.read()).resolves.toEqual(DEFAULT_CONFIG);
    expect(await readdir(dataDirectory)).toEqual([]);
    expect((await stat(dataDirectory)).mode & 0o777).toBe(0o700);
  });

  it("adopts an installation from before the wizard instead of resetting it", async () => {
    await mkdir(dataDirectory);
    await createPagesDatabaseFile(defaultDatabase, {
      users: [{ id: "u1", username: "admin" }],
    });

    const result = await bootstrapConfig(configFile);

    expect(result).toEqual({
      config: { databasePath: defaultDatabase, firstRun: false, port: 3000 },
      isNewConfig: true,
    });
    await expect(configFile.read()).resolves.toEqual(result.config);
  });

  it("runs the setup for a database without an active administrator", async () => {
    await mkdir(dataDirectory);
    await createPagesDatabaseFile(defaultDatabase);

    await expect(bootstrapConfig(configFile)).resolves.toMatchObject({
      config: DEFAULT_CONFIG,
    });
  });

  it("runs the setup when a foreign file lies at the default path", async () => {
    await mkdir(dataDirectory);
    await writeFile(defaultDatabase, "not a database");

    await expect(bootstrapConfig(configFile)).resolves.toMatchObject({
      config: DEFAULT_CONFIG,
    });
  });

  it("keeps an existing configuration and creates nothing for a finished setup", async () => {
    const databasePath = path.join(directory, "elsewhere.duckdb");

    await writeFile(databasePath, "");
    await configFile.write({ databasePath, firstRun: false, port: 4100 });

    await expect(bootstrapConfig(configFile)).resolves.toEqual({
      config: { databasePath, firstRun: false, port: 4100 },
      isNewConfig: false,
    });
    expect(existsSync(dataDirectory)).toBe(false);
  });

  it("refuses to start when the configured database is gone", async () => {
    await configFile.write({
      databasePath: path.join(directory, "gone.duckdb"),
      firstRun: false,
      port: 3000,
    });

    await expect(bootstrapConfig(configFile)).rejects.toThrow(ConfigError);
    await expect(bootstrapConfig(configFile)).rejects.toThrow("does not exist");
  });
});
