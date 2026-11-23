import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { prepareCliUsageHome } from "@/backend/agents/cli/CliUsageHome";

import type * as FsPromises from "node:fs/promises";
import type { CliHome } from "@/backend/agents/cli/CliContracts";

const fileSystem = vi.hoisted(() => ({
  readFile: vi.fn<typeof FsPromises.readFile>(),
}));
const base = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original: typeof FsPromises = await importOriginal();
  fileSystem.readFile.mockImplementation(original.readFile);
  return { ...original, readFile: fileSystem.readFile };
});
vi.mock("@/backend/config/PagesTempDirectory", () => ({
  pagesTempDirectory: (...parts: string[]): string =>
    [base.directory, ...parts].join("/"),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const CREDENTIAL = "auth.json";
let scratch = "";
let connection: CliHome;

async function connectionAt(name: string): Promise<CliHome> {
  const root = path.join(scratch, "connection");
  const config = path.join(root, name);
  await mkdir(config, { recursive: true });
  return {
    root,
    home: path.join(root, "home"),
    config,
    work: path.join(root, "work"),
    sharedEnvironment: "/shared",
  };
}

beforeEach(async () => {
  scratch = path.join(
    os.homedir(),
    ".pages",
    "tmp",
    "usage-home-test",
    randomUUID(),
  );
  base.directory = path.join(scratch, "base");
  connection = await connectionAt("config");
  await writeFile(path.join(connection.config, CREDENTIAL), "original");
});

afterEach(async () => {
  await chmod(path.join(connection.config), 0o700);
  await rm(scratch, { recursive: true, force: true });
});

it("copies the login into a private home and removes it on release", async () => {
  const usage = await prepareCliUsageHome(connection, CREDENTIAL);

  expect(usage.home.sharedEnvironment).toBe("/shared");
  const copy = path.join(usage.home.config, CREDENTIAL);
  expect(await readFile(copy, "utf8")).toBe("original");
  expect((await readdir(usage.home.home)).sort()).toEqual([
    "config",
    "data",
    "state",
  ]);
  expect((await stat(usage.home.work)).isDirectory()).toBe(true);

  await usage.release();
  await expect(stat(usage.home.root)).rejects.toThrow();
  expect(await readFile(path.join(connection.config, CREDENTIAL), "utf8")).toBe(
    "original",
  );
});

it("rejects a connection without a login file", async () => {
  await rm(path.join(connection.config, CREDENTIAL));

  await expect(
    prepareCliUsageHome(connection, CREDENTIAL),
  ).rejects.toMatchObject({ code: "cli_not_logged_in" });
});

it("rethrows an unreadable login of any shape", async () => {
  for (const failure of [null, "text", {}, { code: "EACCES" }]) {
    fileSystem.readFile.mockRejectedValueOnce(failure);
    await expect(prepareCliUsageHome(connection, CREDENTIAL)).rejects.toBe(
      failure,
    );
  }
});

it("reports a home that cannot be created", async () => {
  await mkdir(path.dirname(base.directory), { recursive: true });
  await writeFile(base.directory, "a file, not a folder");

  await expect(
    prepareCliUsageHome(connection, CREDENTIAL),
  ).rejects.toMatchObject({ code: "cli_not_executable" });
});

it("removes the root when the copy cannot be prepared", async () => {
  const clashing = await connectionAt("home");
  await writeFile(path.join(clashing.config, CREDENTIAL), "original");

  await expect(prepareCliUsageHome(clashing, CREDENTIAL)).rejects.toMatchObject(
    { code: "cli_not_executable" },
  );
  const parent = path.join(base.directory, "usage-homes");
  expect(await readdir(parent)).toEqual([]);
});

it("hands a refreshed login back to the connection", async () => {
  const usage = await prepareCliUsageHome(connection, CREDENTIAL);
  await writeFile(path.join(usage.home.config, CREDENTIAL), "refreshed");

  await usage.release();

  const source = path.join(connection.config, CREDENTIAL);
  expect(await readFile(source, "utf8")).toBe("refreshed");
  expect((await readdir(connection.config)).length).toBe(1);
});

it("keeps the login when the copy vanished or did not change", async () => {
  const unchanged = await prepareCliUsageHome(connection, CREDENTIAL);
  await unchanged.release();
  const vanished = await prepareCliUsageHome(connection, CREDENTIAL);
  await rm(path.join(vanished.home.config, CREDENTIAL));
  await vanished.release();

  expect(await readFile(path.join(connection.config, CREDENTIAL), "utf8")).toBe(
    "original",
  );
});

it("keeps a newer login of the connection", async () => {
  const usage = await prepareCliUsageHome(connection, CREDENTIAL);
  await writeFile(path.join(usage.home.config, CREDENTIAL), "refreshed");
  await writeFile(path.join(connection.config, CREDENTIAL), "newer");
  await usage.release();

  expect(await readFile(path.join(connection.config, CREDENTIAL), "utf8")).toBe(
    "newer",
  );
});

it("keeps nothing when the connection lost its login meanwhile", async () => {
  const usage = await prepareCliUsageHome(connection, CREDENTIAL);
  await writeFile(path.join(usage.home.config, CREDENTIAL), "refreshed");
  await rm(path.join(connection.config, CREDENTIAL));
  await usage.release();

  expect((await readdir(connection.config)).length).toBe(0);
});

it("swallows a failure to hand the login back and still removes the home", async () => {
  const usage = await prepareCliUsageHome(connection, CREDENTIAL);
  await writeFile(path.join(usage.home.config, CREDENTIAL), "refreshed");
  await chmod(connection.config, 0o500);

  await expect(usage.release()).resolves.toBeUndefined();
  await expect(stat(usage.home.root)).rejects.toThrow();
  await chmod(connection.config, 0o700);
  expect(await readFile(path.join(connection.config, CREDENTIAL), "utf8")).toBe(
    "original",
  );
});
