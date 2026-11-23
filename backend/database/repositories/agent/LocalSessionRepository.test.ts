import { expect, it, vi, type Mock } from "vitest";

import {
  LocalSessionRepository,
  type LocalSessionEntry,
} from "./LocalSessionRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { LocalOwnerProof } from "@/backend/agents/local/LocalSessionContracts";

const ID = "11111111-1111-4111-8111-111111111111";

const PROOF: LocalOwnerProof = {
  instanceKey: "k",
  instanceId: ID,
  runId: ID,
  stepId: "s1",
  attemptId: ID,
  unit: "unit.service",
  invocationId: "a".repeat(32),
  boot: ID,
  uid: 1000,
  pid: 42,
  start: 7,
  cgroup: "/g",
  arguments: ["a"],
};

const ENCODED = JSON.stringify(PROOF);

const ENTRY: LocalSessionEntry = {
  instanceId: "i1",
  instanceKey: "k",
  runId: "r1",
  stepId: "s1",
  attemptId: "a1",
  manifestDigest: "d",
  proof: null,
  acknowledgedSequence: 4,
  acknowledgedDigest: "dg",
  checkpointFile: null,
  releasedAt: null,
};

function databaseOf(...answers: DatabaseValue[][][]): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => []);
  for (const rows of answers) query.mockResolvedValueOnce(rows);
  return { database: { execute, query }, execute, query };
}

it("reserves the native identity of a session", async () => {
  const { database, execute } = databaseOf();
  await new LocalSessionRepository(database).create({
    instanceId: "i1",
    instanceKey: "k",
    runId: "r1",
    stepId: "s1",
    attemptId: "a1",
    manifestDigest: "d",
  });
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    instance_id: "i1",
    instance_key: "k",
    run_id: "r1",
    step_id: "s1",
    attempt_id: "a1",
    manifest_digest: "d",
  });
});

it("lists the owners of one instance with and without proof", async () => {
  const { database, query } = databaseOf([
    ["i1", "k", "r1", "s1", "a1", "d", null, 0, "", null, null],
    ["i2", "k", "r2", "s2", "a2", "d", ENCODED, 3, "dg", "cp", "t"],
  ]);
  const entries = await new LocalSessionRepository(database).list("k");
  expect(entries[0]).toMatchObject({ instanceId: "i1", proof: null });
  expect(entries[1]).toMatchObject({
    instanceId: "i2",
    proof: PROOF,
    acknowledgedSequence: 3,
    checkpointFile: "cp",
    releasedAt: "t",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ instance_key: "k" });
});

it("stores a proof once", async () => {
  const { database, query } = databaseOf([[null]], [["i1"]]);
  await new LocalSessionRepository(database).prove("i1", PROOF);
  expect(query.mock.calls[1]?.[1]).toEqual({
    instance_id: "i1",
    proof: ENCODED,
  });
});

it("accepts an identical stored proof without updating", async () => {
  const { database, query } = databaseOf([[ENCODED]]);
  await new LocalSessionRepository(database).prove("i1", PROOF);
  expect(query).toHaveBeenCalledTimes(1);
});

it("accepts a proof stored concurrently by an identical writer", async () => {
  const { database } = databaseOf([[null]], [], [[ENCODED]]);
  await expect(
    new LocalSessionRepository(database).prove("i1", PROOF),
  ).resolves.toBeUndefined();
});

it("rejects a proof that cannot be stored", async () => {
  const { database } = databaseOf([[null]], [], [[null]]);
  await expect(
    new LocalSessionRepository(database).prove("i1", PROOF),
  ).rejects.toThrow("Local owner proof changed");
});

it("rejects a different or missing stored proof", async () => {
  await expect(
    new LocalSessionRepository(databaseOf([["other"]]).database).prove(
      "i1",
      PROOF,
    ),
  ).rejects.toThrow("Local owner proof changed");
  await expect(
    new LocalSessionRepository(databaseOf().database).prove("i1", PROOF),
  ).rejects.toThrow("Local owner proof changed");
});

it("keeps the result reference of a turn", async () => {
  const { database, execute } = databaseOf();
  await new LocalSessionRepository(database).saveResult("i1", "t1", "f");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    instance_id: "i1",
    turn_id: "t1",
    payload_file: "f",
  });
});

it("claims the importer fence", async () => {
  const { database, execute } = databaseOf();
  await new LocalSessionRepository(database).claim("i1", "tok");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    instance_id: "i1",
    token: "tok",
  });
});

it("requires exactly one matching importer row", async () => {
  const { database, query } = databaseOf([["i1"]]);
  const repository = new LocalSessionRepository(database);
  await expect(
    repository.requireImporter(ENTRY, "tok"),
  ).resolves.toBeUndefined();
  expect(query.mock.calls[0]?.[1]).toEqual({
    instance_id: "i1",
    token: "tok",
    sequence: 4,
    digest: "dg",
  });
  await expect(repository.requireImporter(ENTRY, "tok")).rejects.toThrow(
    "Concurrent local session importer",
  );
});

it("records the release", async () => {
  const { database, execute } = databaseOf();
  await new LocalSessionRepository(database).released("i1");
  expect(execute.mock.calls[0]?.[1]).toMatchObject({ instance_id: "i1" });
});

it("returns the stored result file or null", async () => {
  await expect(
    new LocalSessionRepository(databaseOf([["f"]]).database).result("i1", "t1"),
  ).resolves.toBe("f");
  await expect(
    new LocalSessionRepository(databaseOf().database).result("i1", "t1"),
  ).resolves.toBeNull();
});

it("acknowledges a replay checkpoint", async () => {
  const { database, query } = databaseOf([["i1"]]);
  const repository = new LocalSessionRepository(database);
  const next = { sequence: 5, digest: "n", checkpointFile: "cp", token: "tok" };
  await repository.acknowledge(ENTRY, next);
  expect(query.mock.calls[0]?.[1]).toEqual({
    instance_id: "i1",
    previous: 4,
    sequence: 5,
    digest: "n",
    checkpoint_file: "cp",
    token: "tok",
  });
  await expect(repository.acknowledge(ENTRY, next)).rejects.toThrow(
    "Concurrent local session importer",
  );
});
