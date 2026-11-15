import { createHash } from "node:crypto";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LocalAcpJournalListener } from "@/backend/agents/local/LocalAcpJournalListener";
import { localJournalRecordSchema } from "@/backend/agents/local/LocalSessionContracts";
import { LocalSessionJournal } from "@/backend/agents/local/LocalSessionJournal";
import { AgentPayloadFileStore } from "@/backend/storage/AgentPayloadFileStore";
import {
  LocalJournalCompaction,
  journalPayloadPath,
} from "@/backend/storage/LocalJournalCompaction";
import { LocalJournalGarbage } from "@/backend/storage/LocalJournalGarbage";

import { journalFiles as files } from "./page415-files";
import { stub } from "./local-sessions-fixture";

import type { AgentSessionRecorder } from "@/backend/service/agents/sessions/AgentSessionRecorder";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { GarbageDatabase } from "@/backend/storage/AgentDeferredGarbage";
import type {
  LocalJournalRecord,
  LocalSessionMutation,
} from "@/backend/agents/local/LocalSessionContracts";

vi.mock("node:fs/promises", async () =>
  (await import("./page415-files")).journalFiles.module(),
);
vi.mock(import("@/backend/logging/Logger"), async (original) => ({
  ...(await original()),
  logCaughtError: vi.fn(),
}));

const ROOT = "/synthetic/page415";
const INSTANCE = "44444444-4444-4444-8444-444444444444";
const DIRECTORY = `${ROOT}/local-sessions/${INSTANCE}`;
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const stores: AgentPayloadFileStore[] = [];

beforeEach(() => files.reset());
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  vi.useRealTimers();
});

function setup(scheduleCleanup?: () => void): {
  journal: LocalSessionJournal;
  store: AgentPayloadFileStore;
} {
  const store = new AgentPayloadFileStore(ROOT);
  stores.push(store);
  return {
    store,
    journal: new LocalSessionJournal(DIRECTORY, "plan", store, scheduleCleanup),
  };
}

function frame(body: string): LocalSessionMutation {
  return { kind: "frame", attemptId: ATTEMPT, channel: "update", body };
}

function journalFile(sequence: number): string {
  return `${DIRECTORY}/journal/${String(sequence).padStart(16, "0")}.json`;
}

function payloadFiles(): string[] {
  return [...files.entries.keys()].filter((name) => name.endsWith(".payload"));
}

function reference(record: LocalJournalRecord): string {
  if (!("payload" in record)) throw new Error("Expected a file reference");
  return record.payload;
}

function compaction(
  removePayload: (reference: string) => Promise<void> = async () => undefined,
): LocalJournalCompaction {
  return new LocalJournalCompaction(ROOT, removePayload);
}

it.each([4095, 4096, 4097])(
  "uses serialized UTF-8 bytes at the %i-byte boundary",
  async (size) => {
    const { journal } = setup();
    await journal.initialize();
    const overhead = Buffer.byteLength(JSON.stringify(frame("")));
    const mutation = frame(
      "ä".repeat(Math.floor((size - overhead) / 2)) +
        "a".repeat((size - overhead) % 2),
    );
    expect(Buffer.byteLength(JSON.stringify(mutation))).toBe(size);
    const record = await journal.append(mutation);
    expect("content" in record).toBe(size <= 4096);
    expect(payloadFiles()).toHaveLength(size <= 4096 ? 0 : 1);
    expect(await journal.body(record)).toEqual(mutation);
    expect(
      localJournalRecordSchema.parse(
        JSON.parse(files.entries.get(journalFile(1))?.content ?? "null"),
      ),
    ).toEqual(record);
  },
);

it("reads and extends unchanged legacy reference records and detects altered inline content", async () => {
  const { journal, store } = setup();
  const mutation = frame("old");
  const payload = await store.write("plan", JSON.stringify(mutation));
  const digest = createHash("sha256")
    .update(JSON.stringify([1, "", payload]))
    .digest("hex");
  const legacy = { sequence: 1, previousDigest: "", payload, digest };
  files.seed(journalFile(1), JSON.stringify(legacy));
  await journal.initialize();
  expect(await journal.body((await journal.page(0))[0] ?? legacy)).toEqual(
    mutation,
  );
  const next = await journal.append(frame("new"));
  expect(next.previousDigest).toBe(digest);
  await expect(
    journal.body({
      sequence: 2,
      previousDigest: digest,
      digest: next.digest,
      content: JSON.stringify(frame("altered")),
    }),
  ).rejects.toThrow("digest");
});

it("deletes only the durable prefix and anchors restart and repeated ACKs without old files", async () => {
  const schedule = vi.fn();
  const { journal, store } = setup(schedule);
  await journal.initialize();
  const first = await journal.append(frame("small"));
  const second = await journal.append(frame("b".repeat(5000)));
  const third = await journal.append(frame("tail"));
  await journal.acknowledge(2, second.digest);
  expect(schedule).toHaveBeenCalledTimes(2);
  expect(files.removed).toEqual([]);
  const database = {
    query: vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]),
  };
  const remove = vi.fn(async (payload: string) => {
    files.entries.delete(`${ROOT}/${journalPayloadPath(payload)}`);
  });
  await compaction(remove).run(database);
  expect(remove).toHaveBeenCalledExactlyOnceWith(reference(second));
  expect(files.entries.has(journalFile(first.sequence))).toBe(false);
  expect(files.entries.has(journalFile(second.sequence))).toBe(false);
  expect(files.entries.has(journalFile(third.sequence))).toBe(true);
  const restarted = new LocalSessionJournal(DIRECTORY, "plan", store);
  await restarted.initialize();
  await restarted.acknowledge(2, second.digest);
  await expect(restarted.acknowledge(2, "wrong")).rejects.toThrow("mismatch");
  const fourth = await restarted.append(frame("restart"));
  expect(fourth).toMatchObject({ sequence: 4, previousDigest: third.digest });
  await restarted.acknowledge(4, fourth.digest);
  await compaction(remove).run(database);
  const emptyRestart = new LocalSessionJournal(DIRECTORY, "plan", store);
  await emptyRestart.initialize();
  expect(await emptyRestart.append(frame("empty prefix"))).toMatchObject({
    sequence: 5,
    previousDigest: fourth.digest,
  });
});

it("keeps database-owned and unacknowledged shared payloads while removing journal files", async () => {
  const { journal } = setup();
  await journal.initialize();
  const result = await journal.append(frame("result".repeat(1000)));
  const shared = await journal.append(frame("shared".repeat(1000)));
  const tail = {
    sequence: 3,
    previousDigest: shared.digest,
    payload: reference(shared),
    digest: "a".repeat(64),
  };
  files.seed(journalFile(3), JSON.stringify(tail));
  await journal.acknowledge(2, shared.digest);
  const database = {
    query: vi
      .fn<DatabaseTransaction["query"]>()
      .mockResolvedValue([[journalPayloadPath(reference(result))]]),
  };
  const remove = vi.fn(async () => undefined);
  await compaction(remove).run(database);
  expect(remove).not.toHaveBeenCalled();
  expect(payloadFiles()).toHaveLength(2);
  expect(files.entries.has(journalFile(1))).toBe(false);
  expect(files.entries.has(journalFile(2))).toBe(false);
  expect(files.entries.has(journalFile(3))).toBe(true);
  const sql = database.query.mock.calls[0]?.[0] ?? "";
  for (const column of [
    "payload_file",
    "checkpoint_file",
    "snapshot_file",
    "engine_file",
    "body_file",
    "events_file",
    "packet_file",
  ])
    expect(sql).toContain(`${column}::jsonb ->> 'path'`);
});

it("retries a crash after payload deletion and leaves unconfirmed files on ACK fsync failure", async () => {
  const { journal } = setup();
  await journal.initialize();
  const record = await journal.append(frame("b".repeat(5000)));
  files.failSync = "ack.json";
  await expect(journal.acknowledge(1, record.digest)).rejects.toThrow("fsync");
  const database = {
    query: vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]),
  };
  const remove = vi.fn(async () => undefined);
  const cleaner = compaction(remove);
  await cleaner.run(database);
  expect(remove).not.toHaveBeenCalled();
  files.failSync = null;
  await journal.acknowledge(1, record.digest);
  files.failRemove = journalFile(1);
  await cleaner.run(database);
  expect(files.entries.has(journalFile(1))).toBe(true);
  files.failRemove = null;
  await cleaner.run(database);
  expect(remove).toHaveBeenCalledTimes(2);
  expect(files.entries.has(journalFile(1))).toBe(false);
});

it("processes an old released session in batches of at most 1000 deleted files", async () => {
  const { store } = setup();
  const payload = await store.write("plan", JSON.stringify(frame("legacy")));
  for (let sequence = 1; sequence <= 1001; sequence += 1)
    files.seed(
      journalFile(sequence),
      JSON.stringify({
        sequence,
        previousDigest: "",
        payload,
        digest: "a".repeat(64),
      }),
    );
  files.seed(
    `${DIRECTORY}/journal/ack.json`,
    JSON.stringify({ sequence: 1001, digest: "a".repeat(64) }),
  );
  const batchSizes: number[] = [];
  const remove = vi.fn(async () => undefined);
  const query = vi.fn<DatabaseTransaction["query"]>(async () => {
    batchSizes.push(remove.mock.calls.length);
    return [];
  });
  await compaction(remove).run({ query });
  expect(batchSizes).toEqual([0, 500, 1000]);
  expect(remove).toHaveBeenCalledTimes(1001);
  expect(
    files.removed.filter((name) => /\d{16}\.json$/u.test(name)),
  ).toHaveLength(1001);
  expect(files.entries.has(`${DIRECTORY}/journal/ack.json`)).toBe(true);
});

it("periodically cleans released sessions even without another commit or live owner", async () => {
  vi.useFakeTimers();
  const { journal } = setup();
  await journal.initialize();
  const first = await journal.append(frame("old"));
  await journal.acknowledge(1, first.digest);
  const worker = new LocalJournalGarbage(compaction());
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  worker.schedule({ query });
  expect(files.entries.has(journalFile(1))).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  await worker.idle();
  expect(files.entries.has(journalFile(1))).toBe(false);
  const second = await journal.append(frame("later"));
  await journal.acknowledge(2, second.digest);
  await vi.advanceTimersByTimeAsync(60_000);
  await worker.idle();
  expect(files.entries.has(journalFile(2))).toBe(false);
  await worker.close();
});

it("the payload store removes acknowledged external files and startup schedules existing prefixes", async () => {
  const { journal, store } = setup();
  await journal.initialize();
  const record = await journal.append(frame("large".repeat(1000)));
  await journal.append(frame("unacknowledged"));
  await journal.acknowledge(1, record.digest);
  const database = stub<GarbageDatabase>({
    query: vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]),
    execute: vi.fn(),
  });
  const restarted = new LocalSessionJournal(DIRECTORY, "plan", store, () =>
    store.scheduleJournalGarbage(database),
  );
  await restarted.initialize();
  expect(payloadFiles()).toHaveLength(1);
  await store.settleGarbage();
  expect(payloadFiles()).toHaveLength(0);
  expect(files.entries.has(journalFile(1))).toBe(false);
  expect(files.entries.has(journalFile(2))).toBe(true);
  expect(
    files.removed.findIndex((name) => name.endsWith(".payload")),
  ).toBeLessThan(files.removed.indexOf(journalFile(1)));
});

it("does not delete anything until the observed ACK directory entry is synchronized", async () => {
  const { journal } = setup();
  await journal.initialize();
  const record = await journal.append(frame("acknowledged"));
  await journal.acknowledge(1, record.digest);
  files.failSync = "/journal";
  const cleaner = compaction();
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  await cleaner.run({ query });
  expect(files.removed).toEqual([]);
  files.failSync = null;
  await cleaner.run({ query });
  expect(files.entries.has(journalFile(1))).toBe(false);
});

it("rejects a missing unacknowledged sequence even when a valid ACK anchor exists", async () => {
  const { journal, store } = setup();
  await journal.initialize();
  const first = await journal.append(frame("first"));
  await journal.append(frame("second"));
  await journal.append(frame("third"));
  await journal.acknowledge(1, first.digest);
  files.entries.delete(journalFile(1));
  files.entries.delete(journalFile(2));
  const restarted = new LocalSessionJournal(DIRECTORY, "plan", store);
  await expect(restarted.initialize()).rejects.toThrow("not contiguous");
});

it("accepts every native update only after its individual journal record is synchronized", async () => {
  const { journal } = setup();
  await journal.initialize();
  const update = vi.fn(() => {
    expect(
      [...files.entries.keys()].some((name) =>
        name.endsWith("0000000000000001.json"),
      ),
    ).toBe(true);
    expect(files.synchronized).toContain(`${DIRECTORY}/journal`);
  });
  const recorder = stub<AgentSessionRecorder>({
    current: { key: { attemptId: ATTEMPT } },
    update,
    drained: vi.fn(),
  });
  const listener = new LocalAcpJournalListener(recorder, journal);
  listener.update({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "a" },
  });
  listener.update({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "b" },
  });
  await listener.drained();
  expect(update).toHaveBeenCalledTimes(2);
  expect(await journal.page(0)).toHaveLength(2);
  expect(payloadFiles()).toHaveLength(0);
  files.failSync = ".pending";
  listener.update({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "c" },
  });
  await expect(listener.drained()).rejects.toThrow("fsync");
  expect(update).toHaveBeenCalledTimes(2);
});
