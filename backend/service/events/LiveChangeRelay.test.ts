import { beforeEach, describe, expect, it, vi } from "vitest";

import { forwardLiveChanges, readRelayedEvent } from "./LiveChangeRelay";

import type { LiveChangeNotificationRepository } from "@/backend/database/repositories/LiveChangeNotificationRepository";
import type { PagesEvent } from "./PagesEventPublisher";

const logger = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logger);
vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: (...call: [string, () => Promise<void>]) =>
    call[1](),
}));

describe("readRelayedEvent", () => {
  it("reads events with and without an audience", () => {
    expect(readRelayedEvent('{"type":"ticket.created","id":"a"}')).toEqual({
      type: "ticket.created",
      id: "a",
    });
    const audience = { projectId: "p", departmentIds: ["d"] };
    expect(
      readRelayedEvent(
        JSON.stringify({ type: "ticket.deleted", id: "a", audience }),
      ),
    ).toEqual({ type: "ticket.deleted", id: "a", audience });
  });

  it("drops malformed payloads", () => {
    expect(readRelayedEvent("{")).toBeNull();
    expect(readRelayedEvent("5")).toBeNull();
    expect(readRelayedEvent("null")).toBeNull();
    expect(readRelayedEvent('{"type":"ticket.created"}')).toBeNull();
    expect(readRelayedEvent('{"id":"a"}')).toBeNull();
    expect(readRelayedEvent('{"type":"nope","id":"a"}')).toBeNull();
    expect(readRelayedEvent('{"type":"ticket.created","id":1}')).toBeNull();
  });

  it("ignores an audience of the wrong shape", () => {
    const base = { type: "ticket.deleted", id: "a" };
    const wrong: unknown[] = [
      null,
      "x",
      { projectId: "p" },
      { departmentIds: [] },
      { projectId: 1, departmentIds: [] },
      { projectId: "p", departmentIds: "d" },
      { projectId: "p", departmentIds: [1] },
    ];
    for (const audience of wrong)
      expect(readRelayedEvent(JSON.stringify({ ...base, audience }))).toEqual(
        base,
      );
  });
});

describe("forwardLiveChanges", () => {
  beforeEach(() => {
    logger.logCaughtError.mockReset();
  });

  function setup(notify: (payload: string) => Promise<void>): {
    emit: (event: PagesEvent) => void;
    repository: LiveChangeNotificationRepository;
    release: () => void;
    stop: ReturnType<typeof vi.fn>;
  } {
    let listener: (event: PagesEvent) => void = () => undefined;
    const stop = vi.fn();
    const source = {
      subscribe: (next: (event: PagesEvent) => void) => {
        listener = next;
        return stop;
      },
    };
    const repository = {
      notify: vi.fn(notify),
    } as unknown as LiveChangeNotificationRepository;
    const release = forwardLiveChanges(source, repository);
    return {
      emit: (event: PagesEvent) => listener(event),
      repository,
      release,
      stop,
    };
  }

  it("notifies known events and returns the release function", () => {
    const { emit, repository, release, stop } = setup(() => Promise.resolve());
    emit({ type: "ticket.created", id: "a" });
    expect(repository.notify).toHaveBeenCalledWith(
      '{"type":"ticket.created","id":"a"}',
    );
    release();
    expect(stop).toHaveBeenCalled();
  });

  it("skips events that are not relayed", () => {
    const { emit, repository } = setup(() => Promise.resolve());
    emit({ type: "asset.linked", id: "a" });
    expect(repository.notify).not.toHaveBeenCalled();
  });

  it("logs a failed notification", async () => {
    const failure = new Error("down");
    const { emit } = setup(() => Promise.reject(failure));
    emit({ type: "ticket.created", id: "a" });
    await vi.waitFor(() =>
      expect(logger.logCaughtError).toHaveBeenCalledWith(
        "LiveChangeRelay",
        failure,
      ),
    );
  });
});
