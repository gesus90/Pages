import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import type * as FileSystem from "node:fs/promises";

import { sharedPnpmBin } from "@/backend/agents/cli/AgentSharedEnvironment";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

const boundary = vi.hoisted(() => ({
  run: vi.fn(),
  read: vi.fn<(file: string, encoding: string) => Promise<string>>(),
}));

vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: boundary.run,
  }),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return { ...original, readFile: boundary.read };
});

import {
  pruneOldBrowsers,
  pruneSharedStore,
} from "./SharedEnvironmentMaintenance";

let directory = "";

beforeEach(async () => {
  const root = pagesTempDirectory("shared-maintenance-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
  boundary.run.mockReset().mockResolvedValue({ stdout: "", stderr: "" });
  boundary.read.mockReset().mockImplementation(async (file, encoding) => {
    expect(encoding).toBe("utf8");
    if (file.endsWith("pnpm-lock.yaml"))
      return "\n      playwright-core:\n        specifier: 1.2.3\n        version: 1.2.3\n";
    if (file.endsWith("package.json"))
      return JSON.stringify({ version: "1.2.3" });
    if (file.endsWith("browsers.json"))
      return JSON.stringify({
        browsers: [
          {
            name: "chromium",
            revision: "123",
            revisionOverrides: { linux: "124" },
          },
          { name: "firefox", revision: "55" },
        ],
      });
    throw new Error("Unexpected file read");
  });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("runs only the pinned pnpm with the instance environment", async () => {
  await pruneSharedStore(directory);
  expect(boundary.run).not.toHaveBeenCalled();
  await mkdir(path.join(directory, "pnpm"));
  await pruneSharedStore(directory);
  expect(boundary.run).not.toHaveBeenCalled();
  const bin = sharedPnpmBin(directory);
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "pnpm"), "fake executable");
  await pruneSharedStore(directory);
  expect(boundary.run).toHaveBeenCalledOnce();
  expect(boundary.run.mock.calls[0][0]).toBe(path.join(bin, "pnpm"));
  expect(boundary.run.mock.calls[0][1]).toEqual(["store", "prune"]);
  const invocation: unknown = boundary.run.mock.calls[0][2];
  expect(invocation).toMatchObject({
    cwd: directory,
    timeout: 180000,
    maxBuffer: 1048576,
    env: {
      HOME: directory,
      PNPM_HOME: path.join(directory, "pnpm"),
      npm_config_store_dir: path.join(directory, "pnpm", "store"),
    },
  });
  const parsed = z
    .object({ env: z.object({ PATH: z.string() }) })
    .parse(invocation);
  expect(parsed.env.PATH.split(path.delimiter)[0]).toBe(bin);
});

it("prunes only old unneeded browser directories and preserves links and overrides", async () => {
  const browserRoot = path.join(directory, "cache", "ms-playwright");
  const outside = path.join(directory, "outside");
  await mkdir(outside);
  await mkdir(browserRoot, { recursive: true });
  for (const name of [
    "chromium-123",
    "chromium-124",
    "firefox-55",
    "chromium-99",
    "webkit-88",
    ".links",
    "unknown-1",
  ]) {
    const location = path.join(browserRoot, name);
    await mkdir(location);
    await utimes(location, 1, 1);
  }
  await mkdir(path.join(browserRoot, "chromium-100"));
  await symlink(outside, path.join(browserRoot, "firefox-99"));
  await writeFile(path.join(browserRoot, "webkit-77"), "file");
  await pruneOldBrowsers(directory, 2000);
  expect((await readdir(browserRoot)).sort()).toEqual([
    ".links",
    "chromium-100",
    "chromium-123",
    "chromium-124",
    "firefox-55",
    "firefox-99",
    "unknown-1",
    "webkit-77",
  ]);
  expect(boundary.read).toHaveBeenCalledTimes(3);
});

it("skips absent and linked browser directories", async () => {
  await pruneOldBrowsers(directory, 2000);
  await mkdir(path.join(directory, "cache"));
  const outside = path.join(directory, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(directory, "cache", "ms-playwright"));
  await pruneOldBrowsers(directory, 2000);
  expect(boundary.read).not.toHaveBeenCalled();
});

it("refuses cleanup when installed and locked versions differ", async () => {
  const browserRoot = path.join(directory, "cache", "ms-playwright");
  await mkdir(path.join(browserRoot, "chromium-99"), { recursive: true });
  boundary.read.mockImplementation(async (file) =>
    file.endsWith("package.json")
      ? '{"version":"other"}'
      : "\n      playwright-core:\n        specifier: 1.2.3\n        version: 1.2.3\n",
  );
  await expect(pruneOldBrowsers(directory, 2000)).rejects.toThrow(
    "Browser cleanup needs the lockfile's installed playwright-core",
  );
  expect(await readdir(browserRoot)).toEqual(["chromium-99"]);
});

it("refuses a malformed browser manifest before removing directories", async () => {
  const browserRoot = path.join(directory, "cache", "ms-playwright");
  await mkdir(path.join(browserRoot, "chromium-99"), { recursive: true });
  boundary.read.mockImplementation(async (file) => {
    if (file.endsWith("package.json")) return '{"version":"1.2.3"}';
    if (file.endsWith("pnpm-lock.yaml"))
      return "\n      playwright-core:\n        specifier: 1.2.3\n        version: 1.2.3\n";
    return '{"browsers":[{"name":"../bad","revision":"123"}]}';
  });
  await expect(pruneOldBrowsers(directory, 2000)).rejects.toThrow();
  expect(await readdir(browserRoot)).toEqual(["chromium-99"]);
});
