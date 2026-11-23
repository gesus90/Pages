import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { localJournalDigest } from "@/backend/agents/local/LocalJournalRecords";
import { LocalSessionJournal } from "@/backend/agents/local/LocalSessionJournal";
import { writeLocalRecord } from "@/backend/agents/local/LocalSessionFiles";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { AgentPayloadFileStore } from "@/backend/storage/AgentPayloadFileStore";

import type { LocalSessionMutation } from "@/backend/agents/local/LocalSessionContracts";

const PLAN_ID = "plan";
const small: LocalSessionMutation = { kind: "identified", sessionId: "small" };
const large: LocalSessionMutation = {
  kind: "identified",
  sessionId: "x".repeat(5000),
};

let root = "";
let files: AgentPayloadFileStore;

beforeEach(async () => {
  const parent = pagesTempDirectory("local-session-journal-test");
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(path.join(parent, "run-"));
  files = new AgentPayloadFileStore(path.join(root, "payloads"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function open(cleanup?: () => void): LocalSessionJournal {
  return new LocalSessionJournal(
    path.join(root, "owner"),
    PLAN_ID,
    files,
    cleanup,
  );
}

function recordFile(sequence: number): string {
  return path.join(
    root,
    "owner",
    "journal",
    `${String(sequence).padStart(16, "0")}.json`,
  );
}

async function filled(count: number): Promise<LocalSessionJournal> {
  const journal = open();
  await journal.initialize();
  for (let index = 0; index < count; index += 1)
    await journal.append({ kind: "identified", sessionId: `s${index}` });
  return journal;
}

it("starts empty and tolerates the default cleanup hook", async () => {
  const journal = open();
  await journal.initialize();
  expect(await journal.page(0)).toEqual([]);
});

it("appends inline and external records that chain their digests", async () => {
  const journal = open();
  await journal.initialize();
  const first = await journal.append(small);
  const second = await journal.append(large);
  expect(first).toMatchObject({ sequence: 1, previousDigest: "" });
  expect("content" in first).toBe(true);
  expect("payload" in second).toBe(true);
  expect(second.previousDigest).toBe(first.digest);
  expect(await journal.page(0)).toEqual([first, second]);
  expect(await journal.body(first)).toEqual(small);
  expect(await journal.body(second)).toEqual(large);
});

it("rejects a mutation that does not match the contract", async () => {
  const journal = open();
  await journal.initialize();
  await expect(
    journal.append({
      kind: "events",
      attemptId: "11111111-1111-4111-8111-111111111111",
      events: Array.from({ length: 201 }, () => ({
        turn: null,
        kind: "status",
        text: "",
        isTruncated: false,
        createdAt: "",
        dedupeKey: null,
      })),
      retain: 0,
    }),
  ).rejects.toThrow();
  expect(await journal.append(small)).toMatchObject({ sequence: 1 });
});

it("rejects a body whose digest does not match", async () => {
  const journal = await filled(1);
  const [record] = await journal.page(0);
  await expect(
    journal.body({ ...record, previousDigest: "tampered" }),
  ).rejects.toThrow("Invalid local journal digest");
});

it("pages with a bounded limit after the acknowledged record", async () => {
  const journal = await filled(3);
  expect((await journal.page(1)).map((record) => record.sequence)).toEqual([
    2, 3,
  ]);
  expect((await journal.page(0, 2)).map((record) => record.sequence)).toEqual([
    1, 2,
  ]);
  expect((await journal.page(0, 0)).map((record) => record.sequence)).toEqual([
    1,
  ]);
  expect(await journal.page(0, 100_000)).toHaveLength(3);
  const [first] = await journal.page(0);
  await journal.acknowledge(first.sequence, first.digest);
  expect((await journal.page(0)).map((record) => record.sequence)).toEqual([
    2, 3,
  ]);
});

it("accepts acknowledgements of existing records only", async () => {
  const cleanup = vi.fn();
  const journal = open(cleanup);
  await journal.initialize();
  cleanup.mockClear();
  const first = await journal.append(small);
  const second = await journal.append(small);
  await expect(journal.acknowledge(3, first.digest)).rejects.toThrow(
    "Invalid local journal acknowledgement",
  );
  await expect(journal.acknowledge(1, second.digest)).rejects.toThrow(
    "Local journal acknowledgement mismatch",
  );
  await writeLocalRecord(recordFile(2), { ...second, previousDigest: "x" });
  await expect(journal.acknowledge(2, second.digest)).rejects.toThrow(
    "Local journal acknowledgement mismatch",
  );
  await journal.acknowledge(1, first.digest);
  expect(cleanup).toHaveBeenCalledOnce();
  await journal.acknowledge(1, first.digest);
  expect(cleanup).toHaveBeenCalledTimes(2);
  await expect(journal.acknowledge(1, "other")).rejects.toThrow(
    "Local journal acknowledgement mismatch",
  );
  await journal.acknowledge(0, "");
  expect(cleanup).toHaveBeenCalledTimes(2);
});

it("recovers the verified tail after the acknowledged anchor", async () => {
  const journal = await filled(3);
  const [first] = await journal.page(0);
  await journal.acknowledge(first.sequence, first.digest);
  const cleanup = vi.fn();
  const recovered = open(cleanup);
  await recovered.initialize();
  expect(cleanup).toHaveBeenCalledOnce();
  expect((await recovered.page(0)).map((record) => record.sequence)).toEqual([
    2, 3,
  ]);
  const next = await recovered.append(small);
  expect(next.sequence).toBe(4);
  expect(await readdir(path.join(root, "owner", "journal"))).toContain(
    "ack.json",
  );
});

it("refuses a journal that is not contiguous", async () => {
  const base = { sequence: 2, previousDigest: "", content: "{}" };
  const bad = [
    { ...base, digest: localJournalDigest(base) },
    {
      sequence: 1,
      previousDigest: "wrong",
      content: "{}",
      digest: localJournalDigest({
        sequence: 1,
        previousDigest: "wrong",
        content: "{}",
      }),
    },
    { sequence: 1, previousDigest: "", content: "{}", digest: "f".repeat(64) },
  ];
  for (const record of bad) {
    await rm(path.join(root, "owner"), { recursive: true, force: true });
    await writeLocalRecord(recordFile(1), record);
    await expect(open().initialize()).rejects.toThrow(
      "Local native journal is not contiguous",
    );
  }
});

it("ignores unrelated files while recovering", async () => {
  const journal = await filled(1);
  await writeLocalRecord(path.join(root, "owner", "journal", "note.json"), {});
  const recovered = open();
  await recovered.initialize();
  expect(await recovered.page(0)).toEqual(await journal.page(0));
});
