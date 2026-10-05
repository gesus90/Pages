import { homedir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();

  return { ...actual, homedir: vi.fn(actual.homedir) };
});

import {
  ConfigError,
  DEFAULT_CONFIG,
  DEFAULT_PORT,
  isValidPort,
  readPagesConfig,
  resolveDefaultConfigPath,
  resolveDefaultDatabasePath,
  resolveDefaultDataDirectory,
  writePagesConfig,
} from "@/backend/config/PagesConfig";

const SOURCE = "/srv/pages/config.toml";

describe("default locations", () => {
  afterEach(() => {
    vi.mocked(homedir).mockRestore();
  });

  it("keeps the configuration in ~/.pages/config.toml", () => {
    expect(resolveDefaultConfigPath()).toBe(
      path.join(homedir(), ".pages", "config.toml"),
    );
  });

  it("refuses to guess without a home directory", () => {
    vi.mocked(homedir).mockReturnValue("");

    expect(() => resolveDefaultConfigPath()).toThrow(ConfigError);
  });

  it("places data and the suggested database next to the configuration", () => {
    expect(resolveDefaultDataDirectory("/home/a/.pages/config.toml")).toBe(
      "/home/a/.pages/data",
    );
    expect(resolveDefaultDatabasePath("/home/a/.pages/config.toml")).toBe(
      "/home/a/.pages/data/pages.duckdb",
    );
  });
});

describe("isValidPort", () => {
  it.each([1, 80, 3000, 65_535])("accepts %s", (port) => {
    expect(isValidPort(port)).toBe(true);
  });

  it.each([0, -1, 65_536, 3000.5, "3000", null])("rejects %s", (port) => {
    expect(isValidPort(port)).toBe(false);
  });
});

describe("readPagesConfig", () => {
  it("uses the defaults for an empty file", () => {
    expect(readPagesConfig({}, SOURCE)).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toEqual({
      databasePath: null,
      firstRun: true,
      port: DEFAULT_PORT,
    });
  });

  it("reads a finished setup", () => {
    expect(
      readPagesConfig(
        {
          databasePath: "/data/../data/pages.duckdb",
          firstRun: false,
          port: 8080,
        },
        SOURCE,
      ),
    ).toEqual({
      databasePath: "/data/pages.duckdb",
      firstRun: false,
      port: 8080,
    });
  });

  it("keeps the database of a reset setup", () => {
    expect(
      readPagesConfig({ databasePath: "/data/pages.duckdb" }, SOURCE),
    ).toEqual({
      databasePath: "/data/pages.duckdb",
      firstRun: true,
      port: DEFAULT_PORT,
    });
  });

  it.each([
    [{ firstRun: "yes" }, '"firstRun" must be true or false.'],
    [{ port: 70_000 }, '"port" must be a whole number from 1 to 65535.'],
    [{ databasePath: "relative.duckdb" }, '"databasePath" must be'],
    [{ databasePath: 7 }, '"databasePath" must be'],
    [{ firstRun: false }, '"databasePath" is missing'],
  ])("names the file and the invalid value %j", (table, message) => {
    expect(() => readPagesConfig(table, SOURCE)).toThrow(ConfigError);
    expect(() => readPagesConfig(table, SOURCE)).toThrow(
      `The configuration file "${SOURCE}" is invalid: `,
    );
    expect(() => readPagesConfig(table, SOURCE)).toThrow(message);
  });
});

describe("writePagesConfig", () => {
  it("keeps unknown keys and their position", () => {
    const document = writePagesConfig(
      { custom: "value", port: 1, tls: { certificate: "/a.pem" } },
      { databasePath: "/data/pages.duckdb", firstRun: false, port: 4000 },
    );

    expect(Object.keys(document)).toEqual([
      "custom",
      "port",
      "tls",
      "firstRun",
      "databasePath",
    ]);
    expect(document).toMatchObject({
      databasePath: "/data/pages.duckdb",
      firstRun: false,
      port: 4000,
      tls: { certificate: "/a.pem" },
    });
  });

  it("drops the database path when none is configured", () => {
    expect(
      writePagesConfig({ databasePath: "/old.duckdb" }, DEFAULT_CONFIG),
    ).toEqual({ firstRun: true, port: DEFAULT_PORT });
  });
});
