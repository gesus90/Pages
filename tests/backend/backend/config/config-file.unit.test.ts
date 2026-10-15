import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { ConfigError } from "@/backend/config/PagesConfig";

import { memoryConfigFiles } from "./memory-config-files";

vi.mock("node:fs/promises", async () =>
  (await import("./memory-config-files")).memoryConfigFiles.promisesModule(),
);

const CONFIG_PATH = "/home/pages/.pages/config.toml";

beforeEach(() => {
  memoryConfigFiles.reset();
});

function seed(content: string): void {
  memoryConfigFiles.files.set(CONFIG_PATH, content);
}

describe("reading", () => {
  it("returns null for a missing file", async () => {
    await expect(new ConfigFile(CONFIG_PATH).read()).resolves.toBeNull();
  });

  it("applies defaults for missing keys", async () => {
    seed("");

    await expect(new ConfigFile(CONFIG_PATH).read()).resolves.toEqual({
      databasePath: null,
      firstRun: true,
      port: 3000,
    });
  });

  it("reads a finished setup", async () => {
    seed(
      'firstRun = false\nport = 4100\ndatabasePath = "/srv/pages/pages.duckdb"\n',
    );

    await expect(new ConfigFile(CONFIG_PATH).read()).resolves.toEqual({
      databasePath: "/srv/pages/pages.duckdb",
      firstRun: false,
      port: 4100,
    });
  });

  it("names the file when the content is not TOML and leaves it untouched", async () => {
    seed("port = [unclosed");

    const reading = new ConfigFile(CONFIG_PATH).read();

    await expect(reading).rejects.toBeInstanceOf(ConfigError);
    await expect(reading).rejects.toThrow(CONFIG_PATH);
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toBe("port = [unclosed");
  });

  it("reports an unreadable file with its cause", async () => {
    const cause = Object.assign(new Error("denied"), { code: "EACCES" });
    seed("");
    memoryConfigFiles.failures.set("readFile", cause);

    await expect(new ConfigFile(CONFIG_PATH).read()).rejects.toMatchObject({
      name: "ConfigError",
      cause,
    });
  });

  it.each([
    ['firstRun = "yes"', /firstRun" must be true or false/u],
    ["port = 0", /port" must be a whole number from 1 to 65535/u],
    ["port = 70000", /port" must be a whole number/u],
    ["port = 80.5", /port" must be a whole number/u],
    ['databasePath = "relative/pages.duckdb"', /absolute file path/u],
    ["databasePath = 5", /absolute file path/u],
    ["firstRun = false", /"databasePath" is missing/u],
  ])("rejects %s", async (content, message) => {
    seed(content);

    await expect(new ConfigFile(CONFIG_PATH).read()).rejects.toThrow(message);
  });
});

describe("writing", () => {
  it("creates the file privately with a header and replaces it in one rename", async () => {
    await new ConfigFile(CONFIG_PATH).write({
      databasePath: null,
      firstRun: true,
      port: 3000,
    });

    const content = memoryConfigFiles.files.get(CONFIG_PATH) ?? "";
    expect(content).toMatch(/^# Pages configuration\./u);
    expect(content).toContain("firstRun = true");
    expect(content).toContain("port = 3000");
    expect(content).not.toContain("databasePath");
    expect(memoryConfigFiles.modes.get(CONFIG_PATH)).toBe(0o600);
    expect(memoryConfigFiles.directories.get("/home/pages/.pages")).toBe(0o700);
    expect([...memoryConfigFiles.files.keys()]).toEqual([CONFIG_PATH]);
  });

  it("keeps keys an operator added by hand", async () => {
    seed('custom = "kept"\nport = 3000\n');

    await new ConfigFile(CONFIG_PATH).write({
      databasePath: "/srv/pages.duckdb",
      firstRun: false,
      port: 4000,
    });

    const content = memoryConfigFiles.files.get(CONFIG_PATH) ?? "";
    expect(content).toContain('custom = "kept"');
    expect(content).toContain("port = 4000");
    expect(content).toContain('databasePath = "/srv/pages.duckdb"');
  });

  it("removes the temporary file and reports a failed write", async () => {
    seed("port = 3000\n");
    memoryConfigFiles.failures.set("rename", new Error("disk full"));

    await expect(
      new ConfigFile(CONFIG_PATH).write({
        databasePath: null,
        firstRun: true,
        port: 4000,
      }),
    ).rejects.toThrow(/cannot be written/u);
    expect([...memoryConfigFiles.files.keys()]).toEqual([CONFIG_PATH]);
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toBe("port = 3000\n");
  });

  it("does not overwrite a file that cannot be parsed", async () => {
    seed("not toml [");

    await expect(
      new ConfigFile(CONFIG_PATH).write({
        databasePath: null,
        firstRun: true,
        port: 3000,
      }),
    ).rejects.toThrow(/not valid TOML/u);
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toBe("not toml [");
  });
});

describe("updating", () => {
  it("derives the new configuration from the stored one and returns it", async () => {
    seed('firstRun = true\nport = 3000\ncustom = "kept"\n');
    const file = new ConfigFile(CONFIG_PATH);

    const next = await file.update((current) => ({
      ...current,
      port: 5000,
    }));

    expect(next.port).toBe(5000);
    await expect(file.read()).resolves.toMatchObject({ port: 5000 });
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toContain(
      'custom = "kept"',
    );
  });

  it("refuses to update a missing file", async () => {
    const change = vi.fn();

    await expect(new ConfigFile(CONFIG_PATH).update(change)).rejects.toThrow(
      /does not exist/u,
    );
    expect(change).not.toHaveBeenCalled();
  });

  it("exposes its path", () => {
    expect(new ConfigFile(CONFIG_PATH).path).toBe(CONFIG_PATH);
  });
});
