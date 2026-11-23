import type { EventEmitter } from "node:events";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  options: vi.fn(),
  instances: [] as unknown[],
}));
vi.mock("@/backend/logging/LogRedaction", () => ({
  registerLogSecret: mocks.register,
}));
vi.mock("pg", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class Client extends Emitter {
    public readonly connect = vi.fn(() => Promise.resolve());
    public readonly query = vi.fn();
    public readonly end = vi.fn(() => Promise.resolve());
    public constructor(options: unknown) {
      super();
      mocks.options(options);
      mocks.instances.push(this);
    }
  }
  return { Client };
});

import { PostgresSessionLock } from "@/backend/database/postgres/PostgresSessionLock";

interface FakeClient extends EventEmitter {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

const URL_WITH_SECRET = "postgres://user:p%40ss@localhost/db";

beforeEach(() => {
  vi.useFakeTimers();
  mocks.instances.length = 0;
});
afterEach(() => vi.useRealTimers());

function create(
  lost = vi.fn(),
  name?: string,
): {
  lock: PostgresSessionLock;
  client: FakeClient;
  lost: ReturnType<typeof vi.fn>;
} {
  const lock = new PostgresSessionLock(URL_WITH_SECRET, lost, name);
  return { lock, client: mocks.instances.at(-1) as FakeClient, lost };
}

it("registers the secrets and names the session", () => {
  create();
  expect(mocks.register).toHaveBeenCalledWith(URL_WITH_SECRET);
  expect(mocks.register).toHaveBeenCalledWith("p%40ss");
  expect(mocks.register).toHaveBeenCalledWith("p@ss");
  expect(mocks.options).toHaveBeenCalledWith(
    expect.objectContaining({ application_name: "pages-integrations-owner" }),
  );
  create(vi.fn(), "other");
  expect(mocks.options).toHaveBeenLastCalledWith(
    expect.objectContaining({ application_name: "other" }),
  );
});

it("keeps the session alive while it owns the lock", async () => {
  const { lock, client, lost } = create();
  client.query.mockResolvedValue({ rows: [{ owned: true }] });
  await expect(lock.acquire("SELECT 1")).resolves.toBe(true);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(client.query).toHaveBeenLastCalledWith("SELECT 1;");
  client.query.mockRejectedValue(new Error("gone"));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(lost).toHaveBeenCalledTimes(1);
  await lock.close();
  expect(client.end).toHaveBeenCalled();
});

it("closes the session when the lock is not owned", async () => {
  const { lock, client } = create();
  client.query.mockResolvedValue({ rows: [] });
  await expect(lock.acquire("SELECT 1")).resolves.toBe(false);
  expect(client.end).toHaveBeenCalled();
});

it("fails without details when the connection fails", async () => {
  const { lock, client } = create();
  client.connect.mockRejectedValue(new Error("secret detail"));
  await expect(lock.acquire("SELECT 1")).rejects.toThrow(
    "Integration ownership connection failed.",
  );
  expect(client.end).toHaveBeenCalled();
});

it("reports a lost session once it is no longer closing", async () => {
  const { lock, client, lost } = create();
  client.emit("error", new Error("x"));
  client.emit("end");
  expect(lost).toHaveBeenCalledTimes(2);
  await lock.close();
  client.emit("end");
  expect(lost).toHaveBeenCalledTimes(2);
});
