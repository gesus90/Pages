import { constants } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import type * as FsPromisesModule from "node:fs/promises";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import {
  readLocalRecord,
  requireLocalDirectory,
  syncLocalDirectory,
  writeLocalRecord,
} from "@/backend/agents/local/LocalSessionFiles";

const overrides = vi.hoisted(() => ({
  rm: null as null | (() => Promise<void>),
  open: null as null | (() => Promise<unknown>),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromisesModule>();
  return {
    ...actual,
    rm: (...args: Parameters<typeof actual.rm>) =>
      overrides.rm ? overrides.rm() : actual.rm(...args),
    open: (...args: Parameters<typeof actual.open>) =>
      overrides.open ? overrides.open() : actual.open(...args),
  };
});

const base = pagesTempDirectory("local-session-files-test");
let root = "";

beforeAll(async () => {
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "case-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
afterEach(() => {
  overrides.rm = null;
  overrides.open = null;
  vi.restoreAllMocks();
});

it("syncs a directory and rejects a missing one", async () => {
  await expect(syncLocalDirectory(root)).resolves.toBeUndefined();
  await expect(syncLocalDirectory(path.join(root, "nope"))).rejects.toThrow();
});

it("creates private directories and rejects unsafe ones", async () => {
  const good = path.join(root, "good");
  await requireLocalDirectory(good);
  await requireLocalDirectory(good);

  const loose = path.join(root, "loose");
  await mkdir(loose);
  await chmod(loose, 0o755);
  await expect(requireLocalDirectory(loose)).rejects.toThrow("not private");

  const target = path.join(root, "target");
  await mkdir(target, { mode: 0o700 });
  const link = path.join(root, "link");
  await symlink(target, link);
  await expect(requireLocalDirectory(link)).rejects.toThrow("not private");

  vi.spyOn(process, "getuid").mockReturnValue(-5);
  await expect(requireLocalDirectory(good)).rejects.toThrow("not private");
});

it("writes and reads a record", async () => {
  const file = path.join(root, "records", "one.json");
  await writeLocalRecord(file, { a: 1 });
  await expect(readLocalRecord(file)).resolves.toEqual({ a: 1 });
  expect(await readdir(path.dirname(file))).toEqual(["one.json"]);
});

it("removes the pending file when publishing fails", async () => {
  const dir = path.join(root, "publish");
  const file = path.join(dir, "blocked");
  await mkdir(dir, { mode: 0o700 });
  await mkdir(file);
  await writeFile(path.join(file, "keep"), "x");
  await expect(writeLocalRecord(file, 1)).rejects.toThrow();
  expect(await readdir(dir)).toEqual(["blocked"]);
});

it("reports both failures when the pending file cannot be removed", async () => {
  const dir = path.join(root, "aggregate");
  const file = path.join(dir, "blocked");
  await mkdir(dir, { mode: 0o700 });
  await mkdir(file);
  await writeFile(path.join(file, "keep"), "x");
  overrides.rm = async () => {
    throw new Error("rm failed");
  };
  await expect(writeLocalRecord(file, 1)).rejects.toBeInstanceOf(
    AggregateError,
  );
});

it("cannot read a missing or symlinked record", async () => {
  await expect(readLocalRecord(path.join(root, "missing"))).rejects.toThrow();
  const real = path.join(root, "real.json");
  await writeLocalRecord(real, 1);
  const link = path.join(root, "real-link.json");
  await symlink(real, link);
  await expect(readLocalRecord(link)).rejects.toThrow();
});

it("rejects directories, foreign owners, open modes and large files", async () => {
  await expect(readLocalRecord(root)).rejects.toThrow("Invalid local session");

  const loose = path.join(root, "loose.json");
  await writeFile(loose, "1", { mode: 0o644 });
  await chmod(loose, 0o644);
  await expect(readLocalRecord(loose)).rejects.toThrow("Invalid local session");

  const owned = path.join(root, "owned.json");
  await writeLocalRecord(owned, 1);
  vi.spyOn(process, "getuid").mockReturnValue(-5);
  await expect(readLocalRecord(owned)).rejects.toThrow("Invalid local session");
  vi.restoreAllMocks();

  const large = path.join(root, "large.json");
  await writeFile(large, "x".repeat(2 * 1024 * 1024 + 1), { mode: 0o600 });
  await expect(readLocalRecord(large)).rejects.toThrow("Invalid local session");
});

it("rejects a record that grows beyond the limit while being read", async () => {
  const file = path.join(root, "grow.json");
  await writeFile(file, "1", { mode: 0o600 });
  const real = await open(file, constants.O_RDONLY);
  const stat = await real.stat();
  overrides.open = async () => ({
    stat: async () => stat,
    readFile: async () => "x".repeat(2 * 1024 * 1024 + 1),
    close: async () => real.close(),
  });
  await expect(readLocalRecord(file)).rejects.toThrow("too large");
  expect(await readFile(file, "utf8")).toBe("1");
});

it("works without a user id on the platform", async () => {
  const original = process.getuid;
  Object.defineProperty(process, "getuid", {
    value: undefined,
    configurable: true,
  });
  try {
    await expect(
      requireLocalDirectory(path.join(root, "nouid")),
    ).rejects.toThrow("not private");
  } finally {
    Object.defineProperty(process, "getuid", {
      value: original,
      configurable: true,
    });
  }
});
