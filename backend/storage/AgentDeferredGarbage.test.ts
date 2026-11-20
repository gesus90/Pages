import {
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

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import { AgentDeferredGarbage } from "./AgentDeferredGarbage";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { GarbageDatabase } from "./AgentDeferredGarbage";
import type { Mock } from "vitest";

const boundary = vi.hoisted(() => ({ purge: vi.fn(), defer: vi.fn() }));
vi.mock("@/backend/database/repositories/agent/AgentPlanRunPurge", () => ({
  PLAN_RUN_PURGE_PREFIX: "plan-runs/",
  purgeEarlierPlanRuns: boundary.purge,
}));
vi.mock("@/backend/database/repositories/agent/AgentPlanPurgeRetry", () => ({
  deferPlanRunPurge: boundary.defer,
}));

const id = "12345678-1234-1234-1234-123456789abc";
let directory = "";

function databaseFor(names: readonly string[]): GarbageDatabase & {
  query: Mock<DatabaseTransaction["query"]>;
  execute: Mock<DatabaseTransaction["execute"]>;
} {
  const query = vi.fn<DatabaseTransaction["query"]>(
    async (statement, parameters) => {
      expect(statement).toContain("agent_payload_garbage");
      return parameters?.after === "" ? names.map((name) => [name]) : [];
    },
  );
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = async <Result>(
    work: (access: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ query, execute });
  return { query, execute, transaction };
}

beforeEach(async () => {
  const root = pagesTempDirectory("deferred-garbage-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
  boundary.purge.mockReset();
  boundary.defer.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

it("removes eligible sessions and journal payloads without following linked directories", async () => {
  const sessions = path.join(
    directory,
    "agents",
    "connection",
    "plan-sessions",
    id,
  );
  const homes = path.join(directory, "agents", "connection", "plan-homes", id);
  const journal = path.join(directory, "local-sessions", id, "journal");
  const outside = path.join(directory, "outside");
  for (const folder of [sessions, homes, journal, outside])
    await mkdir(folder, { recursive: true });
  await writeFile(path.join(outside, "safe"), "retained");
  await mkdir(path.join(directory, "agents", "linked"));
  await symlink(
    outside,
    path.join(directory, "agents", "linked", "plan-sessions"),
  );
  await writeFile(
    path.join(journal, "0000000000000001.json"),
    JSON.stringify({ payload: "payload-ref" }),
  );
  await writeFile(path.join(journal, "0000000000000002.json"), "{broken");
  await writeFile(
    path.join(journal, "0000000000000003.json"),
    JSON.stringify({ payload: 5 }),
  );
  await writeFile(
    path.join(journal, "ignored"),
    JSON.stringify({ payload: "ignored" }),
  );
  const removePayload = vi
    .fn<(reference: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const names = [
    `plan-sessions/${id}/`,
    `plan-homes/${id}/`,
    `local-sessions/${id}/`,
    "future/entry",
  ];
  const database = databaseFor(names);
  const collector = new AgentDeferredGarbage({ directory, removePayload });
  collector.schedule(database);
  collector.schedule(database);
  await collector.idle();
  expect(removePayload).toHaveBeenCalledExactlyOnceWith("payload-ref");
  expect(database.execute).toHaveBeenCalledTimes(3);
  expect(database.execute).not.toHaveBeenCalledWith(expect.any(String), {
    storage_name: "future/entry",
  });
  expect(await readdir(path.dirname(sessions))).toEqual([]);
  expect(await readdir(path.dirname(homes))).toEqual([]);
  await expect(readdir(path.dirname(journal))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(path.join(outside, "safe"), "utf8")).toBe("retained");
  await collector.close();
  collector.schedule(database);
  await collector.idle();
  expect(database.query).toHaveBeenCalledTimes(2);
});

it("retains failed or incomplete work and retries only after the delay", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  boundary.purge.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  boundary.defer.mockResolvedValue(undefined);
  const database = databaseFor([`plan-runs/${id}`]);
  const collector = new AgentDeferredGarbage({
    directory,
    removePayload: async () => {},
    retryDelayMs: 5000,
  });
  collector.schedule(database);
  await collector.idle();
  expect(boundary.defer).toHaveBeenCalledWith(database, id);
  expect(database.execute).not.toHaveBeenCalled();
  collector.schedule(database);
  await collector.idle();
  expect(boundary.purge).toHaveBeenCalledTimes(1);
  vi.setSystemTime(105_000);
  collector.schedule(database);
  await collector.idle();
  expect(boundary.purge).toHaveBeenCalledTimes(2);
  expect(database.execute).toHaveBeenCalledOnce();
  await collector.close();
});

it("retains unknown intents and observes the retry delay without blocking known work", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const known = `plan-sessions/${id}/`;
  const database = databaseFor(["future/entry", known]);
  const collector = new AgentDeferredGarbage({
    directory,
    removePayload: async () => {},
    retryDelayMs: 5000,
  });
  try {
    collector.schedule(database);
    await collector.idle();
    expect(database.execute).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("DELETE FROM agent_payload_garbage"),
      { storage_name: known },
    );
    collector.schedule(database);
    await collector.idle();
    expect(database.query).toHaveBeenCalledTimes(2);
    vi.setSystemTime(105_000);
    collector.schedule(database);
    await collector.idle();
    expect(database.query).toHaveBeenCalledTimes(4);
    expect(database.execute).not.toHaveBeenCalledWith(expect.any(String), {
      storage_name: "future/entry",
    });
  } finally {
    await collector.close();
  }
});

it("keeps a failed deletion queued while continuing other entries", async () => {
  const journal = path.join(directory, "local-sessions", id, "journal");
  await mkdir(journal, { recursive: true });
  await writeFile(
    path.join(journal, "0000000000000001.json"),
    JSON.stringify({ payload: "ref" }),
  );
  const removePayload = vi.fn().mockRejectedValue(new Error("cannot remove"));
  const database = databaseFor([`local-sessions/${id}/`, `plan-homes/${id}/`]);
  const collector = new AgentDeferredGarbage({ directory, removePayload });
  collector.schedule(database);
  await collector.idle();
  expect(database.execute).toHaveBeenCalledTimes(1);
  expect(database.execute).toHaveBeenCalledWith(expect.any(String), {
    storage_name: `plan-homes/${id}/`,
  });
  expect(await readdir(journal)).toEqual(["0000000000000001.json"]);
  await collector.close();
});

it("backs off when reading the queue fails", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const database = databaseFor([]);
  database.query.mockRejectedValueOnce(new Error("database unavailable"));
  const collector = new AgentDeferredGarbage({
    directory,
    removePayload: async () => {},
    retryDelayMs: 1000,
  });
  collector.schedule(database);
  await collector.idle();
  collector.schedule(database);
  await collector.idle();
  expect(database.query).toHaveBeenCalledTimes(1);
  vi.setSystemTime(11_000);
  collector.schedule(database);
  await collector.idle();
  expect(database.query).toHaveBeenCalledTimes(2);
  await collector.close();
});

it("advances across pages while ignoring malformed queue rows", async () => {
  const database = databaseFor([]);
  database.query
    .mockResolvedValueOnce([[null], ["future/entry"]])
    .mockResolvedValueOnce([[`plan-homes/${id}/`]])
    .mockResolvedValueOnce([]);
  const collector = new AgentDeferredGarbage({
    directory,
    removePayload: async () => {},
  });
  collector.schedule(database);
  await collector.idle();
  expect(database.query).toHaveBeenCalledTimes(3);
  expect(database.query.mock.calls[1][1]).toMatchObject({
    after: "future/entry",
  });
  expect(database.query.mock.calls[2][1]).toMatchObject({
    after: `plan-homes/${id}/`,
  });
  expect(database.execute).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("DELETE FROM agent_payload_garbage"),
    { storage_name: `plan-homes/${id}/` },
  );
  expect(database.execute).not.toHaveBeenCalledWith(expect.any(String), {
    storage_name: "future/entry",
  });
  await collector.close();
});

it("terminates a page that contains no valid storage names", async () => {
  const database = databaseFor([]);
  database.query
    .mockResolvedValueOnce([[null], [42]])
    .mockResolvedValueOnce([]);
  const collector = new AgentDeferredGarbage({
    directory,
    removePayload: async () => {},
  });
  collector.schedule(database);
  await collector.idle();
  expect(database.query).toHaveBeenCalledTimes(2);
  expect(database.query.mock.calls[1][1]).toMatchObject({ after: "\uffff" });
  expect(database.execute).not.toHaveBeenCalled();
  await collector.close();
});

it("treats missing or non-directory cleanup targets as already removed", async () => {
  const agents = path.join(directory, "agents");
  await mkdir(path.join(agents, "connection"), { recursive: true });
  await writeFile(path.join(agents, "not-a-connection"), "file");
  await writeFile(path.join(agents, "connection", "plan-sessions"), "file");
  await mkdir(path.join(directory, "local-sessions", id), { recursive: true });
  await writeFile(
    path.join(directory, "local-sessions", id, "journal"),
    "not a directory",
  );
  const missingId = "abcdefab-1234-1234-1234-123456789abc";
  const names = [
    `plan-sessions/${id}/`,
    `plan-homes/${id}/`,
    `local-sessions/${id}/`,
    `local-sessions/${missingId}/`,
  ];
  const database = databaseFor(names);
  const removePayload = vi
    .fn<(reference: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const collector = new AgentDeferredGarbage({ directory, removePayload });
  collector.schedule(database);
  await collector.idle();
  expect(database.execute).toHaveBeenCalledTimes(4);
  expect(removePayload).not.toHaveBeenCalled();
  await expect(
    readdir(path.join(directory, "local-sessions", id)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    await readFile(path.join(agents, "connection", "plan-sessions"), "utf8"),
  ).toBe("file");
  await collector.close();
});

it("skips a collection that was queued before the collector closed", async () => {
  const database = databaseFor([`plan-runs/${id}`]);
  const collector = new AgentDeferredGarbage({
    directory,
    removePayload: async () => {},
  });
  collector.schedule(database);
  await collector.close();
  expect(database.query).not.toHaveBeenCalled();
  expect(boundary.purge).not.toHaveBeenCalled();
});
