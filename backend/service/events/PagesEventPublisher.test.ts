import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isPagesEventType,
  PagesEventIdentityError,
  PagesEventPublisher,
  recordPagesEvent,
} from "./PagesEventPublisher";

import type { PagesEvent } from "./PagesEventPublisher";
import type { Database } from "@/backend/database/Database";

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  hasChangedRows: vi.fn(),
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/backend/database/CallTransaction", () => ({
  afterCallCommit: (effect: () => Promise<void>) => effect(),
  hasChangedRows: mocks.hasChangedRows,
}));
vi.mock(
  "@/backend/database/repositories/events/PagesEventOutboxRepository",
  () => ({
    PagesEventOutboxRepository: class {
      public append = mocks.append;
    },
  }),
);
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logDiagnostic: mocks.logDiagnostic,
  logEvent: mocks.logEvent,
}));

const EVENT: PagesEvent = { type: "ticket.created", id: "t" };
const transaction = { execute: vi.fn() };

function databaseOf(isNested = false): Pick<Database, "runCall"> {
  const runCall = vi.fn(
    async (
      work: () => Promise<unknown>,
      finish: (completion: unknown) => Promise<void>,
    ) => {
      const result = await work();
      await finish({ transaction, result, isNested });
      return result;
    },
  );
  return { runCall } as unknown as Pick<Database, "runCall">;
}

describe("isPagesEventType", () => {
  it("knows its own kinds only", () => {
    expect(isPagesEventType("ticket.created")).toBe(true);
    expect(isPagesEventType("ticket.other")).toBe(false);
  });
});

describe("recordPagesEvent", () => {
  it("appends the event to the outbox", async () => {
    await recordPagesEvent(transaction, EVENT);
    expect(mocks.append).toHaveBeenCalledWith(EVENT);
  });
});

describe("PagesEventPublisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasChangedRows.mockResolvedValue(true);
  });

  it("publishes to subscribers until they release", () => {
    const publisher = new PagesEventPublisher();
    const listener = vi.fn();
    const release = publisher.subscribe(listener);
    publisher.publish(EVENT);
    release();
    publisher.publish(EVENT);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mocks.logEvent).toHaveBeenCalledTimes(2);
  });

  it("survives a failing subscriber", () => {
    const publisher = new PagesEventPublisher();
    const later = vi.fn();
    publisher.subscribe(() => {
      throw new Error("boom");
    });
    publisher.subscribe(later);
    publisher.publish(EVENT);
    expect(later).toHaveBeenCalled();
    expect(mocks.logCaughtError).toHaveBeenCalled();
    expect(mocks.logDiagnostic).toHaveBeenCalled();
  });

  it("needs a database to announce", async () => {
    await expect(
      new PagesEventPublisher().announce(
        () => Promise.resolve(1),
        () => [],
      ),
    ).rejects.toThrow("database");
  });

  it("records and publishes the events of a changed call", async () => {
    const publisher = new PagesEventPublisher(databaseOf());
    const listener = vi.fn();
    publisher.subscribe(listener);
    const result = await publisher.announce(
      () => Promise.resolve("done"),
      () => [EVENT],
    );
    expect(result).toBe("done");
    expect(mocks.append).toHaveBeenCalledWith(EVENT);
    expect(listener).toHaveBeenCalledWith(EVENT);
  });

  it("announces nothing when no row changed", async () => {
    mocks.hasChangedRows.mockResolvedValue(false);
    const decide = vi.fn(() => [EVENT]);
    await new PagesEventPublisher(databaseOf()).announce(
      () => Promise.resolve(1),
      decide,
    );
    expect(decide).not.toHaveBeenCalled();
  });

  it("rejects a change without an event unless nested or decided by result", async () => {
    await expect(
      new PagesEventPublisher(databaseOf()).announce(
        () => Promise.resolve(1),
        () => [],
      ),
    ).rejects.toBeInstanceOf(PagesEventIdentityError);
    await expect(
      new PagesEventPublisher(databaseOf(true)).announce(
        () => Promise.resolve(1),
        () => [],
      ),
    ).resolves.toBe(1);
    await expect(
      new PagesEventPublisher(databaseOf()).announce(
        () => Promise.resolve(1),
        () => [],
        { decidesChange: true },
      ),
    ).resolves.toBe(1);
  });

  it("names the identity error", () => {
    expect(new PagesEventIdentityError().name).toBe("PagesEventIdentityError");
  });
});
