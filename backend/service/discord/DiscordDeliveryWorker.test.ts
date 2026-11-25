import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DiscordDeliveryWorker,
  deliveryNonce,
  MAXIMUM_DELIVERY_ATTEMPTS,
} from "./DiscordDeliveryWorker";

import type { DiscordDeliveryRecord } from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import type { DiscordFailure } from "@/backend/discord/DiscordApiClient";

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logDiagnostic: mocks.logDiagnostic,
}));

const NOW = new Date("2026-03-01T12:00:00.000Z");
const ALL_EVENTS = {
  "milestone.created": true,
  "milestone.updated": true,
  "ticket.created": true,
  "ticket.updated": true,
};

afterEach(() => {
  vi.clearAllMocks();
});

function delivery(
  overrides: Partial<DiscordDeliveryRecord> = {},
): DiscordDeliveryRecord {
  return {
    attempts: 0,
    contentJson: JSON.stringify({
      event: "ticket.created",
      projectName: "Project",
      reference: "TICKET-1",
      status: "Open",
      title: "Title",
      url: "https://pages.example/tasks/TICKET-1",
    }),
    createdAt: NOW.toISOString(),
    eventType: "ticket.updated",
    id: "d1",
    projectId: "p1",
    ...overrides,
  };
}

function failure(
  problem: DiscordFailure["problem"],
  retryAfterSeconds: number | null = null,
): { readonly ok: false; readonly failure: DiscordFailure } {
  return { failure: { problem, retryAfterSeconds, status: null }, ok: false };
}

function createWorker(
  claimed: readonly DiscordDeliveryRecord[],
  withClock = true,
): {
  readonly worker: DiscordDeliveryWorker;
  readonly deliveries: Record<string, ReturnType<typeof vi.fn>>;
  readonly createMessage: ReturnType<typeof vi.fn>;
  readonly findConnection: ReturnType<typeof vi.fn>;
  readonly deleteExpired: ReturnType<typeof vi.fn>;
} {
  const deliveries = {
    claimDue: vi.fn().mockResolvedValue(claimed),
    discard: vi.fn().mockResolvedValue(undefined),
    enqueueDelivery: vi.fn(),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markSent: vi.fn().mockResolvedValue(undefined),
    purge: vi.fn().mockResolvedValue(undefined),
    releaseExpiredLocks: vi.fn().mockResolvedValue(undefined),
    reschedule: vi.fn().mockResolvedValue(undefined),
    summarize: vi.fn(),
  };
  const createMessage = vi.fn().mockResolvedValue({ ok: true, value: null });
  const findConnection = vi
    .fn()
    .mockResolvedValue({ channelId: "c1", events: ALL_EVENTS });
  const deleteExpired = vi.fn().mockResolvedValue(undefined);

  return {
    createMessage,
    deleteExpired,
    deliveries,
    findConnection,
    worker: new DiscordDeliveryWorker({
      attempts: { deleteExpired },
      connections: { findConnection },
      deliveries,
      now: withClock ? () => NOW : undefined,
      sender: { createMessage },
    }),
  };
}

describe("deliveryNonce", () => {
  it("is stable, 24 characters long and differs per delivery", () => {
    expect(deliveryNonce("a")).toBe(deliveryNonce("a"));
    expect(deliveryNonce("a")).toHaveLength(24);
    expect(deliveryNonce("a")).not.toBe(deliveryNonce("b"));
  });
});

describe("DiscordDeliveryWorker.runDue", () => {
  it("cleans up, claims and sends a due message", async () => {
    const { worker, deliveries, deleteExpired, createMessage } = createWorker([
      delivery(),
    ]);

    const result = await worker.runDue();

    expect(result).toEqual({ failed: 0, retried: 0, sent: 1, skipped: 0 });
    expect(deliveries["releaseExpiredLocks"]).toHaveBeenCalledWith(
      NOW.toISOString(),
    );
    expect(deliveries["purge"]).toHaveBeenCalledWith({
      failedBefore: "2026-01-30T12:00:00.000Z",
      sentBefore: "2026-02-22T12:00:00.000Z",
    });
    expect(deleteExpired).toHaveBeenCalledWith("2026-02-28T12:00:00.000Z");
    expect(deliveries["claimDue"]).toHaveBeenCalledWith(
      NOW.toISOString(),
      "2026-03-01T12:02:00.000Z",
      20,
    );
    expect(createMessage).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ allowed_mentions: { parse: [] } }),
      deliveryNonce("d1"),
    );
    expect(deliveries["markSent"]).toHaveBeenCalledWith(
      "d1",
      NOW.toISOString(),
    );
  });

  it("shows the stored event in the message", async () => {
    const { worker, createMessage } = createWorker([delivery()]);

    await worker.runDue();

    const body = createMessage.mock.calls[0]?.[1] as {
      readonly content: string;
    };

    expect(body.content).toContain("Ticket updated");
  });

  it("works with the system clock", async () => {
    const { worker } = createWorker([], false);

    expect(await worker.runDue()).toEqual({
      failed: 0,
      retried: 0,
      sent: 0,
      skipped: 0,
    });
  });

  it("does nothing for an overlapping call", async () => {
    const { worker, deliveries } = createWorker([]);
    let release: () => void = () => undefined;

    deliveries["releaseExpiredLocks"]?.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    const first = worker.runDue();
    const second = await worker.runDue();

    expect(second).toEqual({ failed: 0, retried: 0, sent: 0, skipped: 0 });
    release();
    await first;
    expect(deliveries["claimDue"]).toHaveBeenCalledTimes(1);
  });

  it("can run again after a failed round", async () => {
    const { worker, deliveries } = createWorker([]);

    deliveries["releaseExpiredLocks"]?.mockRejectedValueOnce(new Error("x"));

    await expect(worker.runDue()).rejects.toThrow("x");
    await expect(worker.runDue()).resolves.toMatchObject({ sent: 0 });
  });
});

describe("DiscordDeliveryWorker.runDue (part 2)", () => {
  it("gives up a message with unreadable content", async () => {
    const { worker, deliveries } = createWorker([
      delivery({ attempts: 2, contentJson: "not json" }),
    ]);

    const result = await worker.runDue();

    expect(result.failed).toBe(1);
    expect(deliveries["markFailed"]).toHaveBeenCalledWith("d1", {
      attempts: 3,
      now: NOW.toISOString(),
      problem: "channel_missing",
    });
    expect(mocks.logDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("gives up a message of a project without a connection", async () => {
    const { worker, findConnection } = createWorker([delivery()]);

    findConnection.mockResolvedValue(null);

    expect((await worker.runDue()).failed).toBe(1);
  });

  it("discards a message whose event was switched off", async () => {
    const { worker, findConnection, deliveries, createMessage } = createWorker([
      delivery(),
    ]);

    findConnection.mockResolvedValue({
      channelId: "c1",
      events: { ...ALL_EVENTS, "ticket.updated": false },
    });

    expect((await worker.runDue()).skipped).toBe(1);
    expect(deliveries["discard"]).toHaveBeenCalledWith("d1");
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("gives up a message that is too old", async () => {
    const { worker, deliveries } = createWorker([
      delivery({ createdAt: "2026-02-27T12:00:00.000Z" }),
    ]);

    expect((await worker.runDue()).failed).toBe(1);
    expect(deliveries["markFailed"]).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ problem: "unavailable" }),
    );
  });
});

describe("DiscordDeliveryWorker.runDue (part 3)", () => {
  it("retries a transient failure with a growing delay", async () => {
    const { worker, deliveries, createMessage } = createWorker([
      delivery({ attempts: 1 }),
    ]);

    createMessage.mockResolvedValue(failure("unavailable"));

    expect((await worker.runDue()).retried).toBe(1);
    expect(deliveries["reschedule"]).toHaveBeenCalledWith("d1", {
      attempts: 2,
      nextAttemptAt: "2026-03-01T12:02:00.000Z",
      now: NOW.toISOString(),
      problem: "unavailable",
    });
  });

  it("gives up a permanent problem at once", async () => {
    const { worker, deliveries, createMessage } = createWorker([delivery()]);

    createMessage.mockResolvedValue(failure("bot_removed"));

    expect((await worker.runDue()).failed).toBe(1);
    expect(deliveries["markFailed"]).toHaveBeenCalledWith("d1", {
      attempts: 1,
      now: NOW.toISOString(),
      problem: "bot_removed",
    });
  });

  it("gives up after the last allowed attempt", async () => {
    const { worker, deliveries, createMessage } = createWorker([
      delivery({ attempts: MAXIMUM_DELIVERY_ATTEMPTS - 1 }),
    ]);

    createMessage.mockResolvedValue(failure("unknown"));

    expect((await worker.runDue()).failed).toBe(1);
    expect(deliveries["reschedule"]).not.toHaveBeenCalled();
  });

  it("pauses the run on a rate limit and postpones the rest", async () => {
    const { worker, deliveries, createMessage } = createWorker([
      delivery({ attempts: 1, id: "d1" }),
      delivery({ attempts: 2, id: "d2" }),
      delivery({ attempts: 0, id: "d3" }),
    ]);

    createMessage.mockResolvedValue(failure("rate_limited", 5));

    const result = await worker.runDue();

    expect(result).toEqual({ failed: 0, retried: 1, sent: 0, skipped: 0 });
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(deliveries["reschedule"]).toHaveBeenCalledTimes(3);
    expect(deliveries["reschedule"]).toHaveBeenNthCalledWith(1, "d1", {
      attempts: 1,
      nextAttemptAt: "2026-03-01T12:00:05.000Z",
      now: NOW.toISOString(),
      problem: "rate_limited",
    });
    expect(deliveries["reschedule"]).toHaveBeenNthCalledWith(3, "d3", {
      attempts: 0,
      nextAttemptAt: "2026-03-01T12:00:05.000Z",
      now: NOW.toISOString(),
      problem: "rate_limited",
    });
  });

  it("waits one second when a rate limit names no delay", async () => {
    const { worker, deliveries, createMessage } = createWorker([delivery()]);

    createMessage.mockResolvedValue(failure("rate_limited"));
    await worker.runDue();

    expect(deliveries["reschedule"]).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ nextAttemptAt: "2026-03-01T12:00:01.000Z" }),
    );
  });
});
