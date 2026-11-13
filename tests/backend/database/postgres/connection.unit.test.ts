import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

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

import type { PoolClient, QueryConfig, QueryResult } from "pg";
import type { Mock } from "vitest";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

function createClient(): {
  client: PoolClient;
  emitter: EventEmitter;
  query: Mock<(request: QueryConfig) => Promise<QueryResult | QueryResult[]>>;
  release: ReturnType<typeof vi.fn>;
} {
  const emitter = new EventEmitter();
  const query =
    vi.fn<(request: QueryConfig) => Promise<QueryResult | QueryResult[]>>();
  const release = vi.fn();
  const client = Object.assign(emitter, { query, release });
  return { client, emitter, query, release };
}

describe("PostgresConnection", () => {
  it("binds parameters, returns the last result, and releases a healthy client", async () => {
    const fake = createClient();
    fake.query.mockResolvedValue([
      { command: "SELECT", rows: [["old"]] },
      { command: "SELECT", rows: [["new"]] },
    ]);
    const connection = new PostgresConnection(fake.client, "reader");
    await expect(
      connection.run("SELECT $id", { id: 7 }, "rows"),
    ).resolves.toEqual([["new"]]);
    expect(fake.query).toHaveBeenCalledWith({
      text: "SELECT $1",
      values: [7],
      rowMode: "array",
    });
    connection.release();
    expect(fake.release).toHaveBeenCalledWith(false);
    expect(fake.emitter.listenerCount("error")).toBe(0);
  });

  it("discards a connection with an open transaction and detects silent rollback", async () => {
    const fake = createClient();
    fake.query
      .mockResolvedValueOnce({ command: "BEGIN", rows: [] })
      .mockResolvedValueOnce({ command: "ROLLBACK", rows: [] });
    const connection = new PostgresConnection(fake.client, "writer");
    await connection.run("BEGIN", {}, "execute");
    await expect(
      connection.run("COMMIT", {}, "execute"),
    ).rejects.toBeInstanceOf(AbortedTransactionError);
    connection.release();
    expect(fake.release).toHaveBeenCalledWith(false);
    const second = new PostgresConnection(fake.client, "writer");
    fake.query.mockResolvedValueOnce({ command: "BEGIN", rows: [] });
    await second.run("BEGIN", {}, "execute");
    second.release();
    expect(fake.release).toHaveBeenLastCalledWith(true);
  });

  it.each([
    ["writer", DatabaseOutcomeUnknownError],
    ["reader", DatabaseUnavailableError],
  ] as const)("translates a lost %s connection", async (role, expected) => {
    const fake = createClient();
    fake.query.mockRejectedValue(new Error("connection lost"));
    const connection = new PostgresConnection(fake.client, role);
    await expect(connection.run("SELECT 1", {}, "rows")).rejects.toBeInstanceOf(
      expected,
    );
    connection.release();
    expect(fake.release).toHaveBeenCalledWith(true);
  });

  it("preserves server refusals and discards a connection on an error event", async () => {
    const fake = createClient();
    const refusal = Object.assign(new Error("refused"), {
      severity: "ERROR",
      code: "22021",
    });
    fake.query.mockRejectedValue(refusal);
    const connection = new PostgresConnection(fake.client, "writer");
    await expect(
      connection.run("UPDATE items SET name = $name", { name: "x" }, "execute"),
    ).rejects.toBe(refusal);
    fake.emitter.emit("error", new Error("lost"));
    connection.release();
    expect(fake.release).toHaveBeenCalledWith(true);
    expect(postgresErrorCode(refusal)).toBe("22021");
    expect(postgresErrorCode({ code: "22021" })).toBeNull();
  });

  it("refuses an echoed stand-in for a compared NUL value", async () => {
    const fake = createClient();
    fake.query.mockImplementation((request: QueryConfig) =>
      Promise.resolve({
        command: "SELECT",
        rows: [[request.values?.[0] ?? null]],
      }),
    );
    const connection = new PostgresConnection(fake.client, "reader");
    await expect(
      connection.run("SELECT $name", { name: "a\u0000b" }, "rows"),
    ).rejects.toBeInstanceOf(NulTextQueryError);
    connection.discard();
    connection.release();
    expect(fake.release).toHaveBeenCalledWith(true);
  });
});
