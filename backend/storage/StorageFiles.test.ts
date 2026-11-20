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

import { afterEach, beforeEach, expect, it } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import {
  expireProviderFiles,
  isProtectedProviderEntry,
  physicalStorageDirectory,
  storageBytes,
  storageEntries,
  storageMetadata,
} from "./StorageFiles";

let directory = "";

beforeEach(async () => {
  const root = pagesTempDirectory("storage-files-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("counts files without following symbolic links and resolves only physical directories", async () => {
  const nested = path.join(directory, "nested");
  const outside = path.join(directory, "outside");
  await mkdir(nested);
  await mkdir(outside);
  await writeFile(path.join(nested, "file"), "abc");
  await writeFile(path.join(outside, "file"), "12345");
  await symlink(outside, path.join(nested, "link"));
  expect(await storageBytes(nested)).toBe(3);
  expect(await storageBytes(path.join(nested, "file"))).toBe(3);
  expect(await storageBytes(path.join(nested, "link"))).toBe(0);
  expect(await storageBytes(path.join(directory, "missing"))).toBe(0);
  expect(await storageMetadata(path.join(directory, "missing"))).toBeNull();
  expect(await storageEntries(path.join(nested, "link"))).toEqual([]);
  expect(await storageEntries(path.join(nested, "file"))).toEqual([]);
  expect(await physicalStorageDirectory(directory, "nested")).toBe(nested);
  expect(await physicalStorageDirectory(directory, "nested/link")).toBeNull();
  expect(await physicalStorageDirectory(directory, "missing")).toBeNull();
});

it("expires old unprotected transcripts and retains protected, recent and linked entries", async () => {
  const nested = path.join(directory, "nested");
  const empty = path.join(directory, "empty");
  await mkdir(nested);
  await mkdir(empty);
  await writeFile(path.join(nested, "old.jsonl"), "old");
  await writeFile(path.join(nested, "auth.json"), "secret");
  await writeFile(path.join(nested, "history.sqlite-wal"), "database");
  await writeFile(path.join(nested, "recent.jsonl"), "recent");
  await symlink(nested, path.join(directory, "link"));
  for (const name of ["old.jsonl", "auth.json", "history.sqlite-wal"]) {
    await utimes(path.join(nested, name), 1, 1);
  }
  await expireProviderFiles(directory, Date.now() - 10000);
  expect((await readdir(directory)).sort()).toEqual(["link", "nested"]);
  expect((await readdir(nested)).sort()).toEqual([
    "auth.json",
    "history.sqlite-wal",
    "recent.jsonl",
  ]);
  await expireProviderFiles(path.join(directory, "missing"), Date.now());
});

it("does not expire a transcript through a symbolic link", async () => {
  const target = path.join(directory, "target");
  const maintained = path.join(directory, "maintained");
  await mkdir(target);
  await mkdir(maintained);
  await writeFile(path.join(target, "old.jsonl"), "old");
  await utimes(path.join(target, "old.jsonl"), 1, 1);
  await symlink(target, path.join(maintained, "linked"));

  await expireProviderFiles(maintained, Date.now());

  expect(await readdir(target)).toEqual(["old.jsonl"]);
  expect(await readdir(maintained)).toEqual(["linked"]);
});

it.each([
  ["session.db-wal", true],
  ["settings.json", true],
  [".env.local", true],
  ["transcript.jsonl", false],
  ["database.txt", false],
])("classifies provider entry %s", (name, expected) => {
  expect(isProtectedProviderEntry(name)).toBe(expected);
});
