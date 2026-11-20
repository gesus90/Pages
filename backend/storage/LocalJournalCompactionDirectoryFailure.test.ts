import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type * as FileSystem from "node:fs/promises";
import type { DatabaseTransaction } from "@/backend/database/Database";

const boundary = vi.hoisted(() => ({ stat: vi.fn(), list: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  lstat: boundary.stat,
  readdir: boundary.list,
}));

import { LocalJournalCompaction } from "./LocalJournalCompaction";

it("propagates an inaccessible journal root", async () => {
  const failure = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });
  boundary.stat.mockRejectedValueOnce(failure);
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  await expect(
    new LocalJournalCompaction("/isolated", async () => {}).run({ query }),
  ).rejects.toBe(failure);
  expect(query).not.toHaveBeenCalled();
});

it("continues when a session disappears after listing", async () => {
  const base = pagesTempDirectory("journal-directory-race-tests");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, "case-"));
  const root = path.join(directory, "local-sessions");
  const removed = "12345678-1234-1234-1234-123456789abc";
  const remaining = "abcdefab-1234-1234-1234-123456789abc";
  const filesystem =
    await vi.importActual<typeof FileSystem>("node:fs/promises");
  boundary.stat.mockImplementation(filesystem.lstat);
  boundary.list.mockImplementation(async (location: string) => {
    const entries = await filesystem.readdir(location);
    if (location === root)
      await rm(path.join(root, removed), { recursive: true });
    return entries;
  });
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  try {
    await mkdir(path.join(root, removed), { recursive: true });
    await mkdir(path.join(root, remaining, "journal"), { recursive: true });
    await new LocalJournalCompaction(directory, async () => {}).run({ query });
    expect(await filesystem.readdir(root)).toEqual([remaining]);
    expect(query).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
