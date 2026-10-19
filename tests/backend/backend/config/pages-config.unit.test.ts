import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  ConfigError,
  DEFAULT_CONFIG,
  DEFAULT_PORT,
  isValidPort,
  readPagesConfig,
  resolveAgentsDirectory,
  resolveDefaultConfigPath,
  resolveDefaultDataDirectory,
  resolveDefaultDatabasePath,
  writePagesConfig,
} from "@/backend/config/PagesConfig";
import {
  parseStartOptions,
  StartOptionsError,
} from "@/backend/config/StartOptions";

const homeDirectory = vi.hoisted(() => ({ value: "/home/pages" }));

vi.mock("node:os", () => ({
  homedir: () => homeDirectory.value,
  default: { homedir: () => homeDirectory.value },
}));

describe("isValidPort", () => {
  it.each([1, 80, 3000, 65_535])("accepts %s", (port) => {
    expect(isValidPort(port)).toBe(true);
  });

  it.each([0, -1, 65_536, 1.5, Number.NaN, "3000", null, undefined])(
    "rejects %j",
    (port) => {
      expect(isValidPort(port)).toBe(false);
    },
  );
});

describe("default locations", () => {
  it("derives every location from the configuration file", () => {
    const configPath = "/srv/pages/config.toml";

    expect(resolveDefaultDataDirectory(configPath)).toBe("/srv/pages/data");
    expect(resolveDefaultDatabasePath(configPath)).toBe(
      "/srv/pages/data/pages.duckdb",
    );
    expect(resolveAgentsDirectory(configPath)).toBe("/srv/pages/Agents");
  });

  it("places the default configuration in the home directory", () => {
    expect(resolveDefaultConfigPath()).toBe(
      path.join("/home/pages", ".pages", "config.toml"),
    );
  });

  it("fails when the home directory is unknown", () => {
    homeDirectory.value = "";

    expect(() => resolveDefaultConfigPath()).toThrow(ConfigError);

    homeDirectory.value = "/home/pages";
  });
});

describe("readPagesConfig", () => {
  it("returns the defaults for an empty document", () => {
    expect(readPagesConfig({}, "config.toml")).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.port).toBe(DEFAULT_PORT);
  });

  it("normalizes the database path", () => {
    expect(
      readPagesConfig(
        { databasePath: "/srv/./pages//pages.duckdb", firstRun: false },
        "config.toml",
      ),
    ).toMatchObject({ databasePath: "/srv/pages/pages.duckdb" });
  });

  it("keeps a suggested database while the setup is pending", () => {
    expect(
      readPagesConfig({ databasePath: "/srv/pages.duckdb" }, "config.toml"),
    ).toEqual({
      databasePath: "/srv/pages.duckdb",
      firstRun: true,
      port: 3000,
    });
  });

  it("names the source in the error message", () => {
    expect(() => readPagesConfig({ port: "x" }, "/etc/pages.toml")).toThrow(
      /"\/etc\/pages\.toml" is invalid/u,
    );
  });

  it("reads the trusted proxies of a pending and of a finished setup", () => {
    const trustedProxies = ["127.0.0.1", "::1", "172.18.0.0/16"];

    expect(readPagesConfig({ trustedProxies }, "config.toml")).toMatchObject({
      firstRun: true,
      trustedProxies,
    });
    expect(
      readPagesConfig(
        { databasePath: "/srv/pages.duckdb", firstRun: false, trustedProxies },
        "config.toml",
      ),
    ).toMatchObject({ firstRun: false, trustedProxies });
  });

  it("trusts no proxy when the setting is missing or empty", () => {
    expect(readPagesConfig({}, "config.toml").trustedProxies).toBeUndefined();
    expect(
      readPagesConfig({ trustedProxies: [] }, "config.toml").trustedProxies,
    ).toEqual([]);
  });

  it.each([
    { problem: "not a list", trustedProxies: "127.0.0.1" },
    { problem: "a host name", trustedProxies: ["proxy.internal"] },
    { problem: "a wildcard", trustedProxies: ["*"] },
    { problem: "a range of every address", trustedProxies: ["0.0.0.0/0"] },
    { problem: "a prefix that is too long", trustedProxies: ["10.0.0.0/33"] },
    { problem: "an entry that is not text", trustedProxies: [127] },
    {
      problem: "one bad entry among good ones",
      trustedProxies: ["127.0.0.1", "nope"],
    },
  ])("refuses trustedProxies that are $problem", ({ trustedProxies }) => {
    expect(() =>
      readPagesConfig({ trustedProxies }, "/etc/pages.toml"),
    ).toThrow(/"\/etc\/pages\.toml" is invalid: "trustedProxies" must be/u);
  });
});

describe("writePagesConfig", () => {
  it("replaces the managed keys and keeps all others", () => {
    expect(
      writePagesConfig(
        { custom: 1, databasePath: "/old", port: 1 },
        { databasePath: "/new/pages.duckdb", firstRun: false, port: 2 },
      ),
    ).toEqual({
      custom: 1,
      databasePath: "/new/pages.duckdb",
      firstRun: false,
      port: 2,
    });
  });

  it("stores the trusted proxies without sharing the list", () => {
    const trustedProxies = ["127.0.0.1"];
    const document = writePagesConfig(
      {},
      { databasePath: null, firstRun: true, port: 1, trustedProxies },
    );

    expect(document).toEqual({
      firstRun: true,
      port: 1,
      trustedProxies: ["127.0.0.1"],
    });
    expect(document.trustedProxies).not.toBe(trustedProxies);
  });

  it("keeps the trusted proxies of the file when the configuration names none", () => {
    expect(
      writePagesConfig(
        { trustedProxies: ["127.0.0.1"] },
        { databasePath: null, firstRun: true, port: 1 },
      ),
    ).toMatchObject({ trustedProxies: ["127.0.0.1"] });
  });

  it("removes the database path when none is set and does not change its input", () => {
    const table = { databasePath: "/old", port: 1 };

    expect(
      writePagesConfig(table, { databasePath: null, firstRun: true, port: 1 }),
    ).toEqual({ firstRun: true, port: 1 });
    expect(table).toEqual({ databasePath: "/old", port: 1 });
  });
});

describe("parseStartOptions", () => {
  it("returns no settings without arguments", () => {
    expect(parseStartOptions([])).toEqual({ configPath: null, port: null });
  });

  it("reads separate and inline values", () => {
    expect(parseStartOptions(["--port", "8080"]).port).toBe(8080);
    expect(parseStartOptions(["--port=8081"]).port).toBe(8081);
    expect(parseStartOptions(["--config", "/tmp/c.toml"]).configPath).toBe(
      "/tmp/c.toml",
    );
  });

  it("resolves a relative configuration path", () => {
    expect(parseStartOptions(["--config=conf/c.toml"]).configPath).toBe(
      path.resolve("conf/c.toml"),
    );
  });

  it("lets the last occurrence win", () => {
    expect(parseStartOptions(["--port=1", "--port", "2"]).port).toBe(2);
  });

  it.each([
    [["--verbose"], /Unknown start parameter "--verbose"/u],
    [["8080"], /Unknown start parameter "8080"/u],
    [["--port"], /--port needs a value/u],
    [["--config"], /--config needs a value/u],
    [["--port=abc"], /"abc" is no valid port/u],
    [["--port=0"], /no valid port/u],
    [["--port=65536"], /no valid port/u],
    [["--port=-1"], /no valid port/u],
    [["--port", "80.5"], /no valid port/u],
    [["--config="], /--config needs a file path/u],
    [["--config", "   "], /--config needs a file path/u],
  ])("rejects %j", (argumentList, message) => {
    expect(() => parseStartOptions(argumentList)).toThrow(StartOptionsError);
    expect(() => parseStartOptions(argumentList)).toThrow(message);
  });
});
