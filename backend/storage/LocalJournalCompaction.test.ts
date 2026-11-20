import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import {
  journalPayloadPath,
  LocalJournalCompaction,
} from "./LocalJournalCompaction";

import type { DatabaseTransaction } from "@/backend/database/Database";

const id = "12345678-1234-1234-1234-123456789abc";
const digest = "a".repeat(64);
let directory = "";

async function record(
  journal: string,
  sequence: number,
  body: { payload: string } | { content: string },
): Promise<void> {
  await writeFile(
    path.join(journal, `${String(sequence).padStart(16, "0")}.json`),
    JSON.stringify({ sequence, previousDigest: "", digest, ...body }),
    { mode: 0o600 },
  );
}

beforeEach(async () => {
  const root = pagesTempDirectory("journal-compaction-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("extracts a payload path regardless of property order and rejects invalid references", () => {
  expect(journalPayloadPath('{"size":4,"path":"payload"}')).toBe("payload");
  for (const input of ["null", "[]", "{}", '{"path":1}']) {
    expect(() => journalPayloadPath(input)).toThrow(
      "Invalid local journal payload reference",
    );
  }
  expect(() => journalPayloadPath("bad json")).toThrow(SyntaxError);
});

it("removes acknowledged records only, preserving retained and database-referenced payloads", async () => {
  const journal = path.join(directory, "local-sessions", id, "journal");
  await mkdir(journal, { recursive: true });
  const removed = JSON.stringify({ path: "remove" });
  const referenced = JSON.stringify({ path: "database" });
  const retained = JSON.stringify({ path: "retained" });
  await record(journal, 1, { payload: removed });
  await record(journal, 2, { payload: referenced });
  await record(journal, 3, { payload: retained });
  await record(journal, 4, { content: "inline" });
  await record(journal, 5, { payload: retained });
  await writeFile(
    path.join(journal, "ack.json"),
    JSON.stringify({ sequence: 4, digest }),
    { mode: 0o600 },
  );
  await writeFile(path.join(journal, "unrelated"), "safe");
  await mkdir(path.join(directory, "local-sessions", "not-a-session"));
  const query = vi
    .fn<DatabaseTransaction["query"]>()
    .mockResolvedValue([["database"]]);
  const removePayload = vi
    .fn<(reference: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  await new LocalJournalCompaction(directory, removePayload).run({ query });
  expect(removePayload).toHaveBeenCalledExactlyOnceWith(removed);
  expect(query).toHaveBeenCalledOnce();
  expect(query.mock.calls[0][1]).toEqual({
    paths: JSON.stringify(["remove", "database", "retained"]),
  });
  expect((await readdir(journal)).sort()).toEqual([
    "0000000000000005.json",
    "ack.json",
    "unrelated",
  ]);
});

it("leaves unacknowledged records and tolerates missing or invalid sessions", async () => {
  const compaction = new LocalJournalCompaction(directory, async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  await compaction.run({ query });
  const journal = path.join(directory, "local-sessions", id, "journal");
  await mkdir(journal, { recursive: true });
  await record(journal, 1, { content: "content" });
  await compaction.run({ query });
  expect(await readdir(journal)).toEqual(["0000000000000001.json"]);
  expect(query).not.toHaveBeenCalled();
});

it("compacts a large acknowledged prefix in bounded batches and retains later records", async () => {
  const journal = path.join(directory, "local-sessions", id, "journal");
  await mkdir(journal, { recursive: true });
  const paths = Array.from(
    { length: 501 },
    (_, index) => `payload-${index + 1}`,
  );
  for (let offset = 0; offset < paths.length; offset += 1) {
    await record(journal, offset + 1, {
      payload: JSON.stringify({ path: paths[offset] }),
    });
  }
  await record(journal, 502, { content: "not acknowledged" });
  await writeFile(
    path.join(journal, "ack.json"),
    JSON.stringify({ sequence: 501, digest }),
    { mode: 0o600 },
  );
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  const removePayload = vi
    .fn<(reference: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  await new LocalJournalCompaction(directory, removePayload).run({ query });
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0][1]).toEqual({
    paths: JSON.stringify(paths.slice(0, 500)),
  });
  expect(query.mock.calls[1][1]).toEqual({
    paths: JSON.stringify(paths.slice(500)),
  });
  expect(removePayload).toHaveBeenCalledTimes(501);
  expect((await readdir(journal)).sort()).toEqual([
    "0000000000000502.json",
    "ack.json",
  ]);
});

it("leaves failed payload deletions retryable and continues other sessions", async () => {
  const root = path.join(directory, "local-sessions");
  const otherId = "abcdefab-1234-1234-1234-123456789abc";
  const first = path.join(root, id, "journal");
  const second = path.join(root, otherId, "journal");
  for (const journal of [first, second]) {
    await mkdir(journal, { recursive: true });
    await writeFile(
      path.join(journal, "ack.json"),
      JSON.stringify({ sequence: 1, digest }),
      { mode: 0o600 },
    );
  }
  const reference = JSON.stringify({ path: "retry" });
  await record(first, 1, { payload: reference });
  await record(second, 1, { content: "completed" });
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  const removePayload = vi
    .fn<(reference: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValue(undefined);
  const compaction = new LocalJournalCompaction(directory, removePayload);
  await compaction.run({ query });
  expect((await readdir(first)).sort()).toEqual([
    "0000000000000001.json",
    "ack.json",
  ]);
  expect(await readdir(second)).toEqual(["ack.json"]);
  await compaction.run({ query });
  expect(removePayload).toHaveBeenCalledTimes(2);
  expect(await readdir(first)).toEqual(["ack.json"]);
});

it("skips non-directory session and journal entries without deleting their contents", async () => {
  const root = path.join(directory, "local-sessions");
  await mkdir(path.join(root, id), { recursive: true });
  const otherId = "abcdefab-1234-1234-1234-123456789abc";
  await writeFile(path.join(root, otherId), "not a session directory");
  await writeFile(path.join(root, id, "journal"), "not a journal directory");
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  const removePayload = vi
    .fn<(reference: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  await new LocalJournalCompaction(directory, removePayload).run({ query });
  expect((await readdir(root)).sort()).toEqual([id, otherId]);
  expect(await readdir(path.join(root, id))).toEqual(["journal"]);
  expect(query).not.toHaveBeenCalled();
  expect(removePayload).not.toHaveBeenCalled();
});

it("keeps a damaged journal intact and continues compacting other sessions", async () => {
  const root = path.join(directory, "local-sessions");
  const damaged = path.join(root, id, "journal");
  const healthy = path.join(
    root,
    "abcdefab-1234-1234-1234-123456789abc",
    "journal",
  );
  for (const journal of [damaged, healthy]) {
    await mkdir(journal, { recursive: true });
    await writeFile(
      path.join(journal, "ack.json"),
      JSON.stringify({ sequence: 1, digest }),
      { mode: 0o600 },
    );
  }
  await writeFile(
    path.join(damaged, "0000000000000001.json"),
    JSON.stringify({ sequence: 1, content: "missing digest" }),
    { mode: 0o600 },
  );
  await record(healthy, 1, { content: "healthy" });
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  await new LocalJournalCompaction(directory, async () => {}).run({ query });
  expect((await readdir(damaged)).sort()).toEqual([
    "0000000000000001.json",
    "ack.json",
  ]);
  expect(await readdir(healthy)).toEqual(["ack.json"]);
  expect(query).not.toHaveBeenCalled();
});
