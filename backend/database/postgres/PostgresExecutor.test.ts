import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const pool = {
    handlers: new Map<string, (error: Error) => void>(),
    on: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
  };
  return {
    pool,
    poolOptions: vi.fn(),
    logEvent: vi.fn(),
    logCaught: vi.fn(),
    register: vi.fn(),
    metrics: vi.fn(),
    run: vi.fn(),
    release: vi.fn(),
    clients: [] as unknown[],
  };
});
vi.mock("pg", () => ({
  Pool: class {
    public on = mocks.pool.on.mockImplementation(
      (event: string, handler: (error: Error) => void) => {
        mocks.pool.handlers.set(event, handler);
      },
    );
    public connect = mocks.pool.connect;
    public end = mocks.pool.end;
    public constructor(options: unknown) {
      mocks.poolOptions(options);
    }
  },
  types: { getTypeParser: () => (text: string) => Buffer.from(text) },
}));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: mocks.logEvent,
  logCaughtError: mocks.logCaught,
}));
vi.mock("@/backend/logging/LogRedaction", () => ({
  registerLogSecret: mocks.register,
}));
vi.mock("@/backend/logging/DatabaseLogMetrics", () => ({
  recordDatabaseWaitMetrics: mocks.metrics,
}));
vi.mock("@/backend/database/postgres/PostgresConnection", () => ({
  postgresErrorCode: () => "code",
  PostgresConnection: class {
    public run = mocks.run;
    public release = mocks.release;
    public constructor(client: unknown) {
      mocks.clients.push(client);
    }
  },
}));
vi.mock("@/backend/database/postgres/PostgresWriterOwnership", () => ({
  withPostgresWriterOwnership: <T>(
    connection: unknown,
    work: () => Promise<T>,
  ) => work(),
}));

import { withDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { PostgresExecutor } from "@/backend/database/postgres/PostgresExecutor";

const URL_TEXT = "postgres://user:p%40ss@localhost/db";

beforeEach(() => {
  mocks.pool.handlers.clear();
  mocks.clients.length = 0;
  mocks.pool.connect.mockImplementation(() =>
    Promise.resolve({ release: vi.fn(), id: "client" }),
  );
  mocks.pool.end.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue([[1]]);
});
afterEach(() => vi.useRealTimers());

it("opens the pool, protects the URL and logs lost idle connections", async () => {
  const executor = await PostgresExecutor.start(URL_TEXT);
  expect(mocks.register).toHaveBeenCalledWith("p@ss");
  expect(mocks.poolOptions).toHaveBeenCalledWith(
    expect.objectContaining({ max: 10, connectionString: URL_TEXT }),
  );
  mocks.pool.handlers.get("error")?.(new Error("idle"));
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ event: "database.connection.idle_lost" }),
  );
  expect(executor.status().worker).toMatchObject({ state: "ready", pid: null });
  await executor.close();
});

it("closes the pool when the first connection fails", async () => {
  mocks.pool.connect.mockRejectedValue(new Error("auth"));
  await expect(PostgresExecutor.start(URL_TEXT)).rejects.toThrow("auth");
  expect(mocks.pool.end).toHaveBeenCalled();
});

it("runs writer jobs on a writer connection", async () => {
  const executor = await PostgresExecutor.start(URL_TEXT);
  await expect(
    executor.write((writer) => writer.run("UPDATE t SET a = 1", {}, "execute")),
  ).resolves.toEqual([[1]]);
  expect(mocks.run).toHaveBeenCalledWith("UPDATE t SET a = 1", {}, "execute");
  expect(mocks.release).toHaveBeenCalled();
  await withDatabaseWork({ workClass: "request", signal: undefined }, () =>
    executor.write(() => Promise.resolve()),
  );
  await executor.close();
});

it("releases the connection when a job fails", async () => {
  const executor = await PostgresExecutor.start(URL_TEXT);
  await expect(
    executor.write(() => Promise.reject(new Error("job"))),
  ).rejects.toThrow("job");
  expect(mocks.release).toHaveBeenCalled();
  await executor.close();
});

it("reads on a reader connection", async () => {
  const executor = await PostgresExecutor.start(URL_TEXT);
  await expect(executor.read("SELECT 1", {})).resolves.toEqual([[1]]);
  expect(mocks.run).toHaveBeenCalledWith("SELECT 1", {}, "rows");
  await executor.close();
});

it("answers a snapshot session and ends it", async () => {
  const executor = await PostgresExecutor.start(URL_TEXT);
  await expect(
    executor.readSession(async (session) => {
      await session.query("SELECT 1", {});
      return session.query("SELECT 2", {});
    }),
  ).resolves.toEqual([[1]]);
  const statements = mocks.run.mock.calls.map((call) => call[0] as string);
  expect(statements[0]).toContain("REPEATABLE READ");
  expect(statements.at(-1)).toBe("ROLLBACK;");
  expect(statements.filter((text) => text.startsWith("BEGIN"))).toHaveLength(1);
  await executor.close();
});

it("skips the snapshot end of a session without queries", async () => {
  const executor = await PostgresExecutor.start(URL_TEXT);
  await expect(
    executor.readSession(() => Promise.resolve("idle")),
  ).resolves.toBe("idle");
  expect(mocks.run).not.toHaveBeenCalled();
  await executor.close();
});

it("reports a failing snapshot end without hiding the result", async () => {
  const executor = await PostgresExecutor.start(URL_TEXT);
  mocks.run
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[5]])
    .mockRejectedValue(new Error("rollback"));
  await expect(
    executor.readSession((session) => session.query("SELECT 5", {})),
  ).resolves.toEqual([[5]]);
  expect(mocks.logCaught).toHaveBeenCalledWith(
    "PostgresExecutor",
    expect.any(Error),
  );
  await executor.close();
});

it("tells the caller to retry when no connection opens", async () => {
  const executor = await PostgresExecutor.start(URL_TEXT);
  mocks.pool.connect.mockRejectedValue(new Error("full"));
  await expect(executor.read("SELECT 1", {})).rejects.toMatchObject({
    failure: "unavailable",
  });
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ event: "database.connection.failed" }),
  );
  await executor.close();
});

it("closes after the accepted jobs finished", async () => {
  const executor = await PostgresExecutor.start(URL_TEXT);
  await executor.read("SELECT 1", {});
  await executor.close();
  expect(executor.status().worker.state).toBe("closed");
  expect(mocks.pool.end).toHaveBeenCalled();
});

it("refuses waiting jobs when the drain deadline passes", async () => {
  vi.useFakeTimers();
  const executor = await PostgresExecutor.start(URL_TEXT);
  const stuck = executor.write(() => new Promise<void>(() => undefined));
  stuck.catch(() => undefined);
  await vi.advanceTimersByTimeAsync(0);
  const waiting = executor.write(() => Promise.resolve());
  const refusal = expect(waiting).rejects.toMatchObject({
    failure: "unavailable",
  });
  mocks.pool.end.mockReturnValue(new Promise<void>(() => undefined));
  const closing = executor.close();
  await vi.advanceTimersByTimeAsync(15_000);
  await refusal;
  await vi.advanceTimersByTimeAsync(120_000);
  await closing;
  expect(executor.status().worker.state).toBe("closed");
});
