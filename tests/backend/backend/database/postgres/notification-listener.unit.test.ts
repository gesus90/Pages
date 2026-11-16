import type { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PostgresNotificationListener } from "@/backend/database/postgres/PostgresNotificationListener";

const mocks = vi.hoisted(() => ({
  clients: [] as EventEmitter[],
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
vi.mock("pg", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    Client: class extends Emitter {
      public connect = mocks.connect;
      public query = mocks.query;
      public end = mocks.end;
      public constructor() {
        super();
        mocks.clients.push(this);
      }
    },
  };
});
vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));
vi.mock("@/backend/logging/LogRedaction", () => ({
  registerLogSecret: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  mocks.clients.length = 0;
});

function fixture(): {
  listener: PostgresNotificationListener;
  onListening: ReturnType<typeof vi.fn>;
  onMessage: ReturnType<typeof vi.fn>;
} {
  mocks.connect.mockResolvedValue(undefined);
  mocks.query.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  const onListening = vi.fn();
  const onMessage = vi.fn();
  return {
    listener: new PostgresNotificationListener(
      "postgres://u:p@localhost/db",
      "pages_events",
      { onListening, onMessage },
    ),
    onListening,
    onMessage,
  };
}

describe("PostgreSQL notification listener", () => {
  it("listens and only forwards payloads of its channel", async () => {
    const { listener, onListening, onMessage } = fixture();
    listener.start();
    await vi.waitFor(() => expect(onListening).toHaveBeenCalledOnce());
    const client = mocks.clients[0];
    client?.emit("notification", { channel: "other", payload: "ignored" });
    client?.emit("notification", { channel: "pages_events" });
    client?.emit("notification", { channel: "pages_events", payload: "event" });
    expect(onMessage).toHaveBeenCalledExactlyOnceWith("event");
    expect(mocks.query).toHaveBeenCalledWith("LISTEN pages_events;");
    await listener.stop();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("reconnects after a failed attempt and stops after closure", async () => {
    vi.useFakeTimers();
    const { listener, onListening } = fixture();
    mocks.connect.mockRejectedValueOnce(new Error("offline"));
    listener.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onListening).toHaveBeenCalledOnce();
    mocks.clients[1]?.emit("error", new Error("lost"));
    await listener.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.clients).toHaveLength(2);
  });
});
