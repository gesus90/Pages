import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import {
  AgentPayloadFileStore,
  readAgentPayload,
  readStoredAgentPayload,
  requireAgentFiles,
} from "./AgentPayloadFileStore";

import type {
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type { AgentPayloadReference } from "./AgentPayloadFileStore";

const referenceSchema = z.object({
  version: z.literal(1),
  path: z.string(),
  size: z.number(),
  sha256: z.string(),
});

function parseReference(serialized: string): AgentPayloadReference {
  return referenceSchema.parse(JSON.parse(serialized));
}

let directory = "";
let store: AgentPayloadFileStore;

beforeEach(async () => {
  const root = pagesTempDirectory("payload-store-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
  store = new AgentPayloadFileStore(directory);
});

afterEach(async () => {
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

it("writes immutable UTF-8 payloads with private permissions and verifies references", async () => {
  const contents = "Hello 🌍";
  const serialized = await store.write("plan", contents);
  const reference = parseReference(serialized);
  expect(reference).toEqual({
    version: 1,
    path: reference.path,
    size: Buffer.byteLength(contents),
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
  expect(reference.path).toMatch(
    /^agent-payloads\/[a-f0-9]{64}\/[a-f0-9-]{36}\.payload$/u,
  );
  const file = path.join(directory, reference.path);
  expect(await readFile(file, "utf8")).toBe(contents);
  expect((await lstat(file)).mode & 0o777).toBe(0o600);
  expect((await lstat(path.dirname(file))).mode & 0o777).toBe(0o700);
  expect(await readdir(path.dirname(file))).toEqual([path.basename(file)]);
  await expect(store.read(serialized)).resolves.toBe(contents);
  await expect(
    readAgentPayload({ agentFiles: store }, "inline", serialized),
  ).resolves.toBe(contents);
  await expect(
    readStoredAgentPayload({ agentFiles: store }, serialized),
  ).resolves.toBe(contents);
  const another = parseReference(await store.write("plan", contents));
  expect(another.path).not.toBe(reference.path);
});

it("preserves legacy content and requires configured file storage for references", async () => {
  expect(requireAgentFiles({ agentFiles: store })).toBe(store);
  expect(() => requireAgentFiles({})).toThrow(
    "Agent payload storage is not configured",
  );
  await expect(readAgentPayload({}, "inline", null)).resolves.toBe("inline");
  await expect(readStoredAgentPayload({}, "{broken")).resolves.toBe("{broken");
  await expect(readStoredAgentPayload({}, '{"path":"legacy"}')).resolves.toBe(
    '{"path":"legacy"}',
  );
  await expect(readStoredAgentPayload({}, "null")).resolves.toBe("null");
  await expect(readAgentPayload({}, "inline", "{}")).rejects.toThrow(
    "Agent payload storage is not configured",
  );
  await expect(
    readStoredAgentPayload({}, '{"path":"a","sha256":"b"}'),
  ).rejects.toThrow("Agent payload storage is not configured");
});

it("distinguishes missing, malformed and tampered payloads", async () => {
  const serialized = await store.write("plan", "original");
  const reference = parseReference(serialized);
  const file = path.join(directory, reference.path);
  await writeFile(file, "modified");
  await expect(store.read(serialized)).rejects.toMatchObject({
    code: "plan_payload_corrupt",
  });
  await writeFile(file, "short");
  await expect(store.read(serialized)).rejects.toMatchObject({
    code: "plan_payload_corrupt",
  });
  await rm(file);
  await expect(store.read(serialized)).rejects.toMatchObject({
    code: "plan_payload_missing",
  });
  await expect(store.read("not-json")).rejects.toMatchObject({
    code: "plan_payload_corrupt",
  });
  await expect(
    store.read(JSON.stringify({ ...reference, path: "../outside" })),
  ).rejects.toMatchObject({ code: "plan_payload_corrupt" });
});

it("refuses linked payload files and directories without reading outside the instance", async () => {
  const serialized = await store.write("plan", "secret");
  const reference = parseReference(serialized);
  const file = path.join(directory, reference.path);
  const outside = path.join(directory, "outside");
  await writeFile(outside, "secret");
  await rm(file);
  await symlink(outside, file);
  await expect(store.read(serialized)).rejects.toMatchObject({
    code: "plan_payload_corrupt",
  });
  await rm(path.dirname(file), { recursive: true });
  await symlink(directory, path.dirname(file));
  await expect(store.read(serialized)).rejects.toMatchObject({
    code: "plan_payload_corrupt",
  });
  expect(await readFile(outside, "utf8")).toBe("secret");
});

it("removes committed payload intents and tolerates already missing files", async () => {
  const serialized = await store.write("plan", "content");
  const reference = parseReference(serialized);
  const names = [reference.path, reference.path];
  let readPayloads = false;
  const query = vi.fn<DatabaseTransaction["query"]>(
    async (statement): Promise<readonly DatabaseValue[][]> => {
      if (statement.includes("NOT LIKE")) return [];
      if (readPayloads) return [];
      readPayloads = true;
      return names.map((name) => [name]);
    },
  );
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = async <Result>(
    work: (access: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ query, execute });
  await store.collectGarbage({ query, execute, transaction });
  await store.settleGarbage();
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("DELETE FROM agent_payload_garbage"),
    { storage_name: reference.path },
  );
  await expect(store.read(serialized)).rejects.toMatchObject({
    code: "plan_payload_missing",
  });
});

it("keeps an invalid deletion intent and continues safely", async () => {
  const query = vi.fn(
    async (
      statement: string,
      parameters?: SqlParameters,
    ): Promise<readonly DatabaseValue[][]> => {
      expect(statement).toContain("agent_payload_garbage");
      return parameters ? [] : [["../outside"]];
    },
  );
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = async <Result>(
    work: (access: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ query, execute });
  await store.collectGarbage({ query, execute, transaction });
  await store.settleGarbage();
  expect(execute).not.toHaveBeenCalled();
});

it("drains full deletion batches and removes an explicitly queued plan directory", async () => {
  const first = parseReference(await store.write("batch-plan", "first"));
  const second = parseReference(await store.write("batch-plan", "second"));
  const planDirectory = `${path.posix.dirname(first.path)}/`;
  let batch = 0;
  const query = vi.fn<DatabaseTransaction["query"]>(
    async (statement): Promise<readonly DatabaseValue[][]> => {
      if (statement.includes("NOT LIKE")) return [];
      batch += 1;
      if (batch === 1) return Array.from({ length: 256 }, () => [first.path]);
      if (batch === 2) return [[planDirectory]];
      return [];
    },
  );
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = async <Result>(
    work: (access: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ query, execute });
  await store.collectGarbage({ query, execute, transaction });
  await store.settleGarbage();
  expect(batch).toBe(2);
  expect(execute).toHaveBeenCalledTimes(257);
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining("DELETE FROM agent_payload_garbage"),
    { storage_name: planDirectory },
  );
  await expect(store.read(JSON.stringify(first))).rejects.toMatchObject({
    code: "plan_payload_missing",
  });
  await expect(store.read(JSON.stringify(second))).rejects.toMatchObject({
    code: "plan_payload_missing",
  });
});

it("retains a malformed database deletion entry without executing a delete", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async (statement) =>
    statement.includes("NOT LIKE") ? [] : [[123]],
  );
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = async <Result>(
    work: (access: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ query, execute });
  await store.collectGarbage({ query, execute, transaction });
  await store.settleGarbage();
  expect(execute).not.toHaveBeenCalled();
});

it("removes valid journal payloads while ignoring malformed and unsafe references", async () => {
  const serialized = await store.write("journal-plan", "payload");
  const reference = parseReference(serialized);
  const id = "12345678-1234-1234-1234-123456789abc";
  const journal = path.join(directory, "local-sessions", id, "journal");
  const outside = path.join(directory, "outside");
  await mkdir(journal, { recursive: true });
  await writeFile(outside, "keep");
  const unsafe = JSON.stringify({ ...reference, path: "../outside" });
  for (const [index, payload] of [
    "broken json",
    "{}",
    unsafe,
    serialized,
  ].entries()) {
    await writeFile(
      path.join(journal, `${String(index + 1).padStart(16, "0")}.json`),
      JSON.stringify({ payload }),
    );
  }
  const name = `local-sessions/${id}/`;
  const query = vi.fn<DatabaseTransaction["query"]>(
    async (statement, parameters) => {
      if (!statement.includes("NOT LIKE")) return [];
      return parameters?.after === "" ? [[name]] : [];
    },
  );
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = async <Result>(
    work: (access: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ query, execute });
  await store.collectGarbage({ query, execute, transaction });
  await store.settleGarbage();
  await expect(store.read(serialized)).rejects.toMatchObject({
    code: "plan_payload_missing",
  });
  expect(await readFile(outside, "utf8")).toBe("keep");
  await expect(readdir(path.dirname(journal))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("DELETE FROM agent_payload_garbage"),
    { storage_name: name },
  );
});

it("retains a deletion when its payload directory is replaced with a symlink", async () => {
  const serialized = await store.write("linked-plan", "payload");
  const reference = parseReference(serialized);
  const parent = path.dirname(path.join(directory, reference.path));
  const outside = path.join(directory, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, path.basename(reference.path)), "keep");
  await rm(parent, { recursive: true });
  await symlink(outside, parent);
  const query = vi.fn<DatabaseTransaction["query"]>(async (statement) =>
    statement.includes("NOT LIKE") ? [] : [[reference.path]],
  );
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = async <Result>(
    work: (access: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ query, execute });
  await store.collectGarbage({ query, execute, transaction });
  await store.settleGarbage();
  expect(execute).not.toHaveBeenCalled();
  expect(
    await readFile(path.join(outside, path.basename(reference.path)), "utf8"),
  ).toBe("keep");
});

it("removes unreferenced payloads from acknowledged journal records", async () => {
  const reference = await store.write("journal-plan", "payload");
  const id = "12345678-1234-1234-1234-123456789abc";
  const journal = path.join(directory, "local-sessions", id, "journal");
  const digest = "a".repeat(64);
  await mkdir(journal, { recursive: true });
  await writeFile(
    path.join(journal, "0000000000000001.json"),
    JSON.stringify({
      sequence: 1,
      previousDigest: "",
      digest,
      payload: reference,
    }),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(journal, "ack.json"),
    JSON.stringify({ sequence: 1, digest }),
    { mode: 0o600 },
  );
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = async <Result>(
    work: (access: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ query, execute });
  store.scheduleJournalGarbage({ query, execute, transaction });
  await store.settleGarbage();
  await expect(store.read(reference)).rejects.toMatchObject({
    code: "plan_payload_missing",
  });
  expect(await readdir(journal)).toEqual(["ack.json"]);
  expect(query).toHaveBeenCalledOnce();
});

it("treats a deletion intent whose payload directory is absent as done", async () => {
  const name = `agent-payloads/${"a".repeat(64)}/${"1".repeat(8)}-1111-1111-1111-${"1".repeat(12)}.payload`;
  const query = vi.fn<DatabaseTransaction["query"]>(
    async (statement, parameters): Promise<readonly DatabaseValue[][]> => {
      expect(statement).toContain("agent_payload_garbage");
      return parameters ? [] : [[name]];
    },
  );
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = async <Result>(
    work: (access: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ query, execute });
  await store.collectGarbage({ query, execute, transaction });
  await store.settleGarbage();
  expect(execute).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("DELETE FROM agent_payload_garbage"),
    { storage_name: name },
  );
});

it("refuses to write below a linked payload root", async () => {
  const elsewhere = path.join(directory, "elsewhere");
  await mkdir(elsewhere);
  await symlink(elsewhere, path.join(directory, "agent-payloads"));
  await expect(store.write("plan", "content")).rejects.toThrow(
    "Invalid agent payload directory.",
  );
  expect(await readdir(elsewhere)).toEqual([]);
});
