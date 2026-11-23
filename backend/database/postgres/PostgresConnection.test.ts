import { EventEmitter } from "node:events";

import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logEvent: vi.fn<(event: { metadata?: Record<string, unknown> }) => void>(),
  record: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/backend/database/DatabaseStats", () => ({
  recordDatabaseQuery: mocks.record,
}));

import {
  DatabaseOutcomeUnknownError,
  DatabaseUnavailableError,
} from "@/backend/database/executor/DatabaseExecutorErrors";
import {
  AbortedTransactionError,
  NulTextQueryError,
  PostgresConnection,
  postgresErrorCode,
} from "@/backend/database/postgres/PostgresConnection";

class FakeClient extends EventEmitter {
  public readonly query = vi.fn();
  public readonly release = vi.fn();
}

function open(role: "writer" | "reader" = "writer"): {
  client: FakeClient;
  connection: PostgresConnection;
} {
  const client = new FakeClient();
  return {
    client,
    connection: new PostgresConnection(client, role),
  };
}

beforeEach(() => mocks.logEvent.mockClear());

it("runs a statement with values and returns its rows", async () => {
  const { client, connection } = open();
  client.query.mockResolvedValue({ rows: [[1]], command: "SELECT" });
  await expect(connection.run("SELECT $a", { a: 1 }, "rows")).resolves.toEqual([
    [1],
  ]);
  expect(client.query).toHaveBeenCalledWith({
    text: "SELECT $1",
    values: [1],
    rowMode: "array",
  });
  expect(mocks.record).toHaveBeenCalled();
});

it("uses the simple protocol without values and drops rows in execute mode", async () => {
  const { client, connection } = open();
  client.query.mockResolvedValue({ rows: [[1]], command: "SELECT" });
  await expect(connection.run("SELECT 1", {}, "execute")).resolves.toEqual([]);
  expect(client.query).toHaveBeenCalledWith({
    text: "SELECT 1",
    rowMode: "array",
  });
});

it("answers with the rows of the last statement of a batch", async () => {
  const { client, connection } = open();
  client.query.mockResolvedValueOnce([{ rows: [[1]] }, { rows: [[2]] }]);
  await expect(
    connection.run("SELECT 1; SELECT 2", {}, "rows"),
  ).resolves.toEqual([[2]]);
  client.query.mockResolvedValueOnce([]);
  await expect(connection.run("SELECT 1", {}, "rows")).resolves.toEqual([]);
});

it("reports removed U+0000 characters", async () => {
  const { client, connection } = open();
  client.query.mockResolvedValue({ rows: [], command: "UPDATE" });
  await connection.run("UPDATE t SET a = $a", { a: "x\u0000" }, "execute");
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "database.text.nul_removed",
      metadata: { count: 1 },
    }),
  );
});

it("turns the COMMIT of an aborted transaction into an error", async () => {
  const { client, connection } = open();
  client.query.mockResolvedValue([{ command: "ROLLBACK", rows: [] }]);
  await expect(connection.run("COMMIT", {}, "execute")).rejects.toBeInstanceOf(
    AbortedTransactionError,
  );
  client.query.mockResolvedValue({ command: "COMMIT", rows: [] });
  await expect(connection.run("COMMIT", {}, "execute")).resolves.toEqual([]);
  client.query.mockResolvedValue([]);
  await expect(connection.run("COMMIT", {}, "execute")).resolves.toEqual([]);
});

it("passes statement refusals on and keeps the connection", async () => {
  const { client, connection } = open();
  const refusal = Object.assign(new Error("no"), {
    severity: "ERROR",
    code: "23505",
  });
  client.query.mockRejectedValue(refusal);
  await expect(connection.run("SELECT 1", {}, "rows")).rejects.toBe(refusal);
  connection.release();
  expect(client.release).toHaveBeenCalledWith(false);
  expect(mocks.logEvent.mock.calls[0]?.[0].metadata).toMatchObject({
    code: "23505",
    operation: "SELECT",
  });
});

it("treats a lost connection of a writer as an unknown outcome", async () => {
  const { client, connection } = open("writer");
  client.query.mockRejectedValue(new Error("gone"));
  await expect(connection.run("(SELECT 1)", {}, "rows")).rejects.toBeInstanceOf(
    DatabaseOutcomeUnknownError,
  );
  connection.release();
  expect(client.release).toHaveBeenCalledWith(true);
});

it("treats a lost connection of a reader as unavailable", async () => {
  const { client, connection } = open("reader");
  client.query.mockRejectedValue("gone");
  await expect(connection.run("SELECT 1", {}, "rows")).rejects.toBeInstanceOf(
    DatabaseUnavailableError,
  );
});

it("refuses a result that echoes a compared text with U+0000", async () => {
  const { client, connection } = open();
  client.query.mockImplementation((query: { values: string[] }) =>
    Promise.resolve({ rows: [[7, query.values[0]]], command: "SELECT" }),
  );
  await expect(
    connection.run("SELECT 1 WHERE a = $a", { a: "x\u0000" }, "rows"),
  ).rejects.toBeInstanceOf(NulTextQueryError);
  client.query.mockResolvedValue({ rows: [[7, "other"]], command: "SELECT" });
  await expect(
    connection.run("SELECT 1 WHERE a = $a", { a: "x\u0000" }, "rows"),
  ).resolves.toEqual([[7, "other"]]);
});

it("closes a connection that holds a transaction or was discarded", async () => {
  const first = open();
  first.client.query.mockResolvedValue({ rows: [], command: "BEGIN" });
  await first.connection.run("BEGIN", {}, "execute");
  first.connection.release();
  expect(first.client.release).toHaveBeenCalledWith(true);
  const second = open();
  second.connection.discard();
  second.connection.release();
  expect(second.client.release).toHaveBeenCalledWith(true);
});

it("notes an error of the checked-out connection and stops listening on release", () => {
  const { client, connection } = open("reader");
  client.emit("error", Object.assign(new Error("x"), { code: "57P01" }));
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ event: "database.connection.lost" }),
  );
  connection.release();
  expect(client.release).toHaveBeenCalledWith(true);
  expect(client.listenerCount("error")).toBe(0);
});

it("reads codes of errors", () => {
  expect(postgresErrorCode("x")).toBeNull();
  expect(postgresErrorCode(new Error("x"))).toBeNull();
  expect(
    postgresErrorCode(Object.assign(new Error("x"), { code: 5 })),
  ).toBeNull();
  expect(
    postgresErrorCode(Object.assign(new Error("x"), { code: "28P01" })),
  ).toBe("28P01");
});

it("names its errors", () => {
  expect(new AbortedTransactionError().name).toBe("AbortedTransactionError");
  expect(new NulTextQueryError().name).toBe("NulTextQueryError");
});
