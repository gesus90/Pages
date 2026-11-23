import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  logEvent: vi.fn(),
  instances: [] as unknown[],
  behavior: {
    connect: () => Promise.resolve(),
    query: () => Promise.resolve(),
    end: () => Promise.resolve(),
  },
}));
vi.mock("@/backend/logging/LogRedaction", () => ({
  registerLogSecret: mocks.register,
}));
vi.mock("@/backend/logging/Logger", () => ({ logEvent: mocks.logEvent }));
vi.mock("pg", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class Client extends Emitter {
    public readonly connect = vi.fn(() => mocks.behavior.connect());
    public readonly query = vi.fn(() => mocks.behavior.query());
    public readonly end = vi.fn(() => mocks.behavior.end());
    public constructor() {
      super();
      mocks.instances.push(this);
    }
  }
  return { Client };
});

import { PostgresNotificationListener } from "@/backend/database/postgres/PostgresNotificationListener";

import type { EventEmitter } from "node:events";

interface FakeClient extends EventEmitter {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

const clients = (): FakeClient[] => mocks.instances as FakeClient[];

beforeEach(() => {
  vi.useFakeTimers();
  mocks.instances.length = 0;
  mocks.behavior = {
    connect: () => Promise.resolve(),
    query: () => Promise.resolve(),
    end: () => Promise.reject(new Error("end failed")),
  };
});
afterEach(() => vi.useRealTimers());

function create(): {
  listener: PostgresNotificationListener;
  onMessage: ReturnType<typeof vi.fn>;
  onListening: ReturnType<typeof vi.fn>;
} {
  const onMessage = vi.fn();
  const onListening = vi.fn();
  const listener = new PostgresNotificationListener(
    "postgres://u:p%40@h/db",
    "chan",
    { onMessage, onListening },
  );
  return { listener, onMessage, onListening };
}

it("listens, forwards payloads of its channel and reports listening", async () => {
  const { listener, onMessage, onListening } = create();
  listener.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(onListening).toHaveBeenCalledTimes(1);
  expect(clients()[0]?.query).toHaveBeenCalledWith("LISTEN chan;");
  clients()[0]?.emit("notification", { channel: "chan", payload: "p" });
  clients()[0]?.emit("notification", { channel: "other", payload: "q" });
  clients()[0]?.emit("notification", { channel: "chan" });
  expect(onMessage).toHaveBeenCalledTimes(1);
  expect(onMessage).toHaveBeenCalledWith("p");
  await listener.stop();
});

it("reconnects after a loss with a growing wait", async () => {
  const { listener, onListening } = create();
  listener.start();
  await vi.advanceTimersByTimeAsync(0);
  clients()[0]?.emit("error", new Error("x"));
  clients()[0]?.emit("end");
  expect(mocks.logEvent).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(clients()).toHaveLength(2);
  expect(onListening).toHaveBeenCalledTimes(2);
  await listener.stop();
});

it("retries a failed attempt with doubling waits up to a limit", async () => {
  mocks.behavior.connect = () => Promise.reject(new Error("down"));
  const { listener } = create();
  listener.start();
  await vi.advanceTimersByTimeAsync(0);
  for (const wait of [2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]) {
    const before = clients().length;
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(clients()).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(clients()).toHaveLength(before + 1);
  }
  await listener.stop();
});

it("retries when LISTEN fails", async () => {
  mocks.behavior.query = () => Promise.reject(new Error("no"));
  const { listener, onListening } = create();
  listener.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(onListening).not.toHaveBeenCalled();
  expect(clients()[0]?.end).toHaveBeenCalled();
  await listener.stop();
});

it("does not connect after stop and ends the current session", async () => {
  const { listener } = create();
  listener.start();
  await vi.advanceTimersByTimeAsync(0);
  await listener.stop();
  expect(clients()[0]?.end).toHaveBeenCalled();
  listener.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(clients()).toHaveLength(1);
  await listener.stop();
});

it("cancels a pending reconnect on stop", async () => {
  mocks.behavior.connect = () => Promise.reject(new Error("down"));
  const { listener } = create();
  listener.start();
  await vi.advanceTimersByTimeAsync(0);
  await listener.stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(clients()).toHaveLength(1);
});

it("closes a session that finished connecting after a stop", async () => {
  let finish = (): void => undefined;
  mocks.behavior.connect = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const { listener, onListening } = create();
  listener.start();
  await vi.advanceTimersByTimeAsync(0);
  await listener.stop();
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(onListening).not.toHaveBeenCalled();
  expect(clients()[0]?.end).toHaveBeenCalled();
});

it("closes a session that was lost while connecting", async () => {
  let finish = (): void => undefined;
  mocks.behavior.connect = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const { listener, onListening } = create();
  listener.start();
  await vi.advanceTimersByTimeAsync(0);
  clients()[0]?.emit("end");
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(onListening).not.toHaveBeenCalled();
  await listener.stop();
});

it("stops without a session", async () => {
  const { listener } = create();
  await expect(listener.stop()).resolves.toBeUndefined();
});

it("keeps one reconnect timer when several sessions are lost", async () => {
  const { listener } = create();
  listener.start();
  listener.start();
  await vi.advanceTimersByTimeAsync(0);
  clients()[0]?.emit("end");
  clients()[1]?.emit("end");
  expect(mocks.logEvent).toHaveBeenCalledTimes(1);
  await listener.stop();
});
