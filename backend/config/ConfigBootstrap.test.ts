import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { bootstrapConfig } from "./ConfigBootstrap";
import { ConfigFile } from "./ConfigFile";
import {
  DEFAULT_CONFIG,
  resolveDefaultDataDirectory,
  resolveDefaultDatabasePath,
} from "./PagesConfig";
import { pagesTempDirectory } from "./PagesTempDirectory";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

let directory = "";
let configPath = "";

beforeEach(async () => {
  const root = pagesTempDirectory("config-bootstrap-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
  configPath = path.join(directory, "config.toml");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("creates a private initial configuration and reads it on subsequent starts", async () => {
  const file = new ConfigFile(configPath);
  expect(await bootstrapConfig(file)).toEqual({
    config: DEFAULT_CONFIG,
    isNewConfig: true,
  });
  expect((await stat(configPath)).mode & 0o777).toBe(0o600);
  expect(
    (await stat(resolveDefaultDataDirectory(configPath))).isDirectory(),
  ).toBe(true);
  expect(await bootstrapConfig(file)).toEqual({
    config: DEFAULT_CONFIG,
    isNewConfig: false,
  });
});

it("rejects an existing legacy database without creating configuration", async () => {
  const databasePath = resolveDefaultDatabasePath(configPath);
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, "legacy");
  await expect(bootstrapConfig(new ConfigFile(configPath))).rejects.toThrow(
    "legacy database",
  );
  await expect(readFile(configPath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("creates the configured data directory for completed setup", async () => {
  const databasePath = path.join(directory, "stored", "pages.db");
  const file = new ConfigFile(configPath);
  await file.write({
    ...DEFAULT_CONFIG,
    firstRun: false,
    databasePath,
    databaseUrl: "postgresql://localhost/pages",
  });
  const result = await bootstrapConfig(file);
  expect(result.isNewConfig).toBe(false);
  expect(result.config).toMatchObject({ firstRun: false, databasePath });
  expect((await stat(path.dirname(databasePath))).isDirectory()).toBe(true);
});

it("preserves unrelated TOML keys and serializes updates", async () => {
  const file = new ConfigFile(configPath);
  await writeFile(configPath, 'operatorSetting = "kept"\n');
  await file.write(DEFAULT_CONFIG);
  await Promise.all([
    file.update((config) => ({ ...config, port: 1234 })),
    file.update((config) => ({ ...config, port: config.port + 1 })),
  ]);
  expect(await file.read()).toMatchObject({ port: 1235 });
  expect(await readFile(configPath, "utf8")).toContain(
    'operatorSetting = "kept"',
  );
});

it("reports missing, invalid and unreadable configuration files", async () => {
  const file = new ConfigFile(configPath);
  await expect(file.update((config) => config)).rejects.toThrow(
    "does not exist",
  );
  await writeFile(configPath, "invalid = [");
  await expect(file.read()).rejects.toThrow("not valid TOML");
  await rm(configPath);
  await mkdir(configPath);
  await expect(file.read()).rejects.toThrow("cannot be read");
});
