import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapConfig } from "@/backend/config/ConfigBootstrap";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { inspectPagesDatabase } from "@/backend/database/PagesDatabaseInspector";

import { memoryConfigFiles } from "./memory-config-files";

import type { PagesDatabaseInspection } from "@/backend/database/PagesDatabaseInspector";

vi.mock("node:fs/promises", async () =>
  (await import("./memory-config-files")).memoryConfigFiles.promisesModule(),
);
vi.mock("node:fs", async () =>
  (await import("./memory-config-files")).memoryConfigFiles.syncModule(),
);
vi.mock("@/backend/database/PagesDatabaseInspector", () => ({
  inspectPagesDatabase: vi.fn(),
}));

function pagesInspection(
  hasActiveAdministrator: boolean,
): PagesDatabaseInspection {
  return { kind: "pages", hasActiveAdministrator };
}

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
    expect(inspectPagesDatabase).not.toHaveBeenCalled();
    expect(memoryConfigFiles.files.has(DATABASE_PATH)).toBe(false);
  });

  it("adopts an older database with an active administrator as finished setup", async () => {
    memoryConfigFiles.files.set(DATABASE_PATH, "");
    vi.mocked(inspectPagesDatabase).mockResolvedValue(pagesInspection(true));

    const result = await bootstrapConfig(new ConfigFile(CONFIG_PATH));

    expect(result).toEqual({
      config: { databasePath: DATABASE_PATH, firstRun: false, port: 3000 },
      isNewConfig: true,
    });
  });

  it.each([
    ["a Pages database without an administrator", pagesInspection(false)],
    ["a foreign database", { kind: "foreign" } as const],
    ["a locked database", { kind: "locked" } as const],
  ])("runs the setup for %s", async (_, inspection) => {
    memoryConfigFiles.files.set(DATABASE_PATH, "");
    vi.mocked(inspectPagesDatabase).mockResolvedValue(inspection);

    const result = await bootstrapConfig(new ConfigFile(CONFIG_PATH));

    expect(result.config).toMatchObject({ firstRun: true });
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
      `firstRun = false\ndatabasePath = "${DATABASE_PATH}"\n`,
    );

    const result = await bootstrapConfig(new ConfigFile(CONFIG_PATH));

    expect(result.isNewConfig).toBe(false);
    expect(memoryConfigFiles.directories.size).toBe(0);
  });

  it("refuses a finished setup whose database is missing", async () => {
    memoryConfigFiles.files.set(
      CONFIG_PATH,
      `firstRun = false\ndatabasePath = "${DATABASE_PATH}"\n`,
    );

    await expect(bootstrapConfig(new ConfigFile(CONFIG_PATH))).rejects.toThrow(
      /does not exist/u,
    );
  });
});
