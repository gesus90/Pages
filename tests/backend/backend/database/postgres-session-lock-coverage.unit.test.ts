import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PostgresSessionLock } from "@/backend/database/postgres/PostgresSessionLock";

const mock = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  listeners: new Map<string, () => void>(),
}));
vi.mock("pg", () => ({
  Client: class {
    public readonly connect = mock.connect;
    public readonly query = mock.query;
    public readonly end = mock.end;
    /** Records a synthetic client event listener. */
    public on(event: string, callback: () => void): void {
      mock.listeners.set(event, callback);
    }
  },
}));

afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.resetAllMocks();
  mock.listeners.clear();
  mock.connect.mockResolvedValue(undefined);
  mock.end.mockResolvedValue(undefined);
});

it("holds an acquired lock, checks the session and stops checking after close", async () => {
  vi.useFakeTimers();
  mock.query
    .mockResolvedValueOnce({ rows: [{ owned: true }] })
    .mockResolvedValue({ rows: [] });
  const lost = vi.fn();
  const lock = new PostgresSessionLock(
    "postgres://user:synthetic@localhost/db",
    lost,
  );
  await expect(lock.acquire("SELECT lock")).resolves.toBe(true);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mock.query).toHaveBeenCalledWith("SELECT 1;");
  mock.listeners.get("error")?.();
  expect(lost).toHaveBeenCalledOnce();
  await lock.close();
  mock.listeners.get("end")?.();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(lost).toHaveBeenCalledOnce();
  expect(mock.query).toHaveBeenCalledTimes(2);
});

it("closes an unowned or failed session without leaking the underlying error", async () => {
  mock.query.mockResolvedValueOnce({ rows: [{ owned: false }] });
  const lock = new PostgresSessionLock(
    "postgres://user:synthetic@localhost/db",
    vi.fn(),
  );
  await expect(lock.acquire("SELECT lock")).resolves.toBe(false);
  expect(mock.end).toHaveBeenCalledOnce();
  mock.connect.mockRejectedValueOnce(new Error("private connection details"));
  const failing = new PostgresSessionLock(
    "postgres://user:synthetic@localhost/db",
    vi.fn(),
  );
  await expect(failing.acquire("SELECT lock")).rejects.toThrow(
    "Integration ownership connection failed.",
  );
});
