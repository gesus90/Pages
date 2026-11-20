import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
  open,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import { openDailyLog, prepareLogDirectory } from "./LogFiles";
import type * as NodeFsPromises from "node:fs/promises";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  return { ...actual, open: vi.fn(actual.open) };
});

const createdRoots: string[] = [];
const DAILY_DATE = "2026-11-20";
const DAILY_NAME = `pages-${DAILY_DATE}.jsonl`;

/** Creates an isolated folder below the Pages temporary directory for one test. */
async function createTestRoot(): Promise<string> {
  const root = pagesTempDirectory("logging-tests", randomUUID());
  createdRoots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(
    createdRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Writes the daily file with the given bytes, reopens it and returns the repaired content. */
async function repairedContent(content: string | Buffer): Promise<string> {
  const root = await createTestRoot();
  await writeFile(path.join(root, DAILY_NAME), content);
  const handle = await openDailyLog(root, DAILY_DATE);
  await handle.close();
  return readFile(path.join(root, DAILY_NAME), "utf8");
}

it("creates a missing log directory that only its owner can use", async () => {
  const root = await createTestRoot();
  const directory = path.join(root, "nested", "log");

  await prepareLogDirectory(directory);

  expect((await stat(directory)).mode & 0o777).toBe(0o700);
});

it("tightens an existing log directory to owner-only access", async () => {
  const directory = path.join(await createTestRoot(), "log");
  await mkdir(directory, { mode: 0o755 });

  await prepareLogDirectory(directory);

  expect((await stat(directory)).mode & 0o777).toBe(0o700);
});

it("refuses a symbolic link at the managed log root", async () => {
  const root = await createTestRoot();
  const target = path.join(root, "target");
  const link = path.join(root, "log");
  await mkdir(target);
  await symlink(target, link);

  await expect(prepareLogDirectory(link)).rejects.toThrow(
    "Log directory must be a real directory",
  );
});

it("creates the daily file privately and returns an open handle", async () => {
  const root = await createTestRoot();

  const handle = await openDailyLog(root, DAILY_DATE);

  expect((await stat(path.join(root, DAILY_NAME))).mode & 0o777).toBe(0o600);
  await handle.close();
});

it("refuses a daily path that opens as something other than a regular file", async () => {
  const root = await createTestRoot();
  const actualFs =
    await vi.importActual<typeof NodeFsPromises>("node:fs/promises");
  vi.mocked(open).mockResolvedValueOnce(await actualFs.open(root, "r"));

  await expect(openDailyLog(root, DAILY_DATE)).rejects.toThrow(
    "Daily log must be a regular file",
  );
});

it("keeps an empty daily file empty", async () => {
  expect(await repairedContent("")).toBe("");
});

it("keeps a file whose last record already ends with a newline", async () => {
  expect(await repairedContent('{"a":1}\n')).toBe('{"a":1}\n');
});

it("adds the missing newline after a complete record", async () => {
  expect(await repairedContent('{"a":1}')).toBe('{"a":1}\n');
});

it("discards a torn record after the last complete line", async () => {
  expect(await repairedContent('{"a":1}\n{"b":')).toBe('{"a":1}\n');
});

it("discards a complete JSON array, primitive or null without a newline", async () => {
  expect(await repairedContent("[1]")).toBe("");
  expect(await repairedContent("5")).toBe("");
  expect(await repairedContent("null")).toBe("");
});

it("discards a torn record that has no newline at all", async () => {
  expect(await repairedContent('{"a":')).toBe("");
});

it("discards a long torn record that spans several read chunks", async () => {
  expect(await repairedContent("x".repeat(70_000))).toBe("");
});

it("keeps the complete lines before a long torn record", async () => {
  expect(await repairedContent(`{"a":1}\n${"x".repeat(70_000)}`)).toBe(
    '{"a":1}\n',
  );
});

it("keeps a long complete record whose opening newline is in an earlier chunk", async () => {
  const record = `{"complete":"${"z".repeat(70_000)}"}`;

  expect(await repairedContent(`\n${record}`)).toBe(`\n${record}\n`);
});

it("keeps a complete record that ends in the last chunk after an earlier newline", async () => {
  const head = `${"y".repeat(70_000)}\n`;

  expect(await repairedContent(`${head}{"complete":true}`)).toBe(
    `${head}{"complete":true}\n`,
  );
});

it("discards a long single record that never contains a newline", async () => {
  expect(await repairedContent(`{"a":"${"z".repeat(70_000)}"`)).toBe("");
});
