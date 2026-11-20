import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

import type * as FileSystem from "node:fs/promises";

const failures = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return { ...original, rename: failures.rename };
});
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

import { ConfigFile } from "./ConfigFile";
import { DEFAULT_CONFIG } from "./PagesConfig";
import { pagesTempDirectory } from "./PagesTempDirectory";

it("removes the temporary file when replacing the configuration fails", async () => {
  const root = pagesTempDirectory("config-file-failure-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "case-"));
  const configPath = path.join(directory, "config.toml");
  failures.rename.mockRejectedValueOnce(new Error("rename failed"));
  try {
    const file = new ConfigFile(configPath);
    await expect(file.write(DEFAULT_CONFIG)).rejects.toThrow(
      "cannot be written",
    );
    expect(await readdir(directory)).toEqual([]);
    await expect(readFile(configPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
