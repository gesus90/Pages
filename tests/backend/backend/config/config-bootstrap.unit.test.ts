import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapConfig } from "@/backend/config/ConfigBootstrap";
import { ConfigFile } from "@/backend/config/ConfigFile";

import { memoryConfigFiles } from "./memory-config-files";

vi.mock("node:fs/promises", async () =>
  (await import("./memory-config-files")).memoryConfigFiles.promisesModule(),
);
vi.mock("node:fs", async () =>
  (await import("./memory-config-files")).memoryConfigFiles.syncModule(),
);
const CONFIG_PATH = "/srv/pages/config.toml";
const DATABASE_PATH = "/srv/pages/data/pages.duckdb";

beforeEach(() => {
  memoryConfigFiles.reset();
});

describe("first start without a configuration file", () => {
  it("writes a pending setup and prepares the data directory", async () => {
    const file = new ConfigFile(CONFIG_PATH);

    const result = await bootstrapConfig(file);

    expect(result).toEqual({
      config: { databasePath: null, firstRun: true, port: 3000 },
      isNewConfig: true,
    });
    expect(memoryConfigFiles.files.has(CONFIG_PATH)).toBe(true);
    expect(memoryConfigFiles.directories.get("/srv/pages/data")).toBe(0o700);
    expect(memoryConfigFiles.files.has(DATABASE_PATH)).toBe(false);
  });

  it("refuses automatic adoption of a legacy database", async () => {
    memoryConfigFiles.files.set(DATABASE_PATH, "");
    await expect(bootstrapConfig(new ConfigFile(CONFIG_PATH))).rejects.toThrow(
      /legacy database/u,
    );
    expect(memoryConfigFiles.files.has(DATABASE_PATH)).toBe(true);
  });
});

describe("start with a configuration file", () => {
  it("returns the stored configuration unchanged", async () => {
    memoryConfigFiles.files.set(CONFIG_PATH, "firstRun = true\nport = 4000\n");

    const result = await bootstrapConfig(new ConfigFile(CONFIG_PATH));

    expect(result).toEqual({
      config: { databasePath: null, firstRun: true, port: 4000 },
      isNewConfig: false,
    });
    expect(memoryConfigFiles.directories.has("/srv/pages/data")).toBe(true);
  });

  it("accepts a finished setup whose database exists", async () => {
    memoryConfigFiles.files.set(DATABASE_PATH, "");
    memoryConfigFiles.files.set(
      CONFIG_PATH,
      `firstRun = false\ndatabasePath = "${DATABASE_PATH}"\ndatabaseUrl = "postgresql://localhost/pages"\n`,
    );

    const result = await bootstrapConfig(new ConfigFile(CONFIG_PATH));

    expect(result.isNewConfig).toBe(false);
    expect(memoryConfigFiles.directories.get("/srv/pages/data")).toBe(0o700);
  });

  it("refuses a finished setup without a PostgreSQL URL", async () => {
    memoryConfigFiles.files.set(
      CONFIG_PATH,
      `firstRun = false\ndatabasePath = "${DATABASE_PATH}"\n`,
    );

    await expect(bootstrapConfig(new ConfigFile(CONFIG_PATH))).rejects.toThrow(
      /databaseUrl/u,
    );
  });
});
