import { afterEach, describe, expect, it, vi } from "vitest";

import { PicaMobileCalendarHandler } from "@/backend/service/mobile/calendar/PicaMobileCalendarHandler";

import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { PicaMobileCalendarClientMessage } from "@/backend/service/mobile/calendar/PicaMobileCalendarMessages";
import type { PicaMobileCalendarProvider } from "@/backend/service/mobile/calendar/PicaMobileCalendarProvider";
import type { PicaMobilePlansHost } from "@/backend/service/mobile/plans/PicaMobilePlansHandler";

const SESSION = { userId: "anna", sessionToken: "token" };
const TARGETS: PicaMobileCalendarClientMessage = {
  type: "calendar_targets",
  requestId: "t",
  payload: {},
};

interface World {
  readonly handler: PicaMobileCalendarHandler;
  readonly host: PicaMobilePlansHost;
  readonly provider: PicaMobileCalendarProvider;
  readonly frames: string[];
  readonly tasks: (() => Promise<void>)[];
  emit(event: PagesEvent): void;
}

function world(overrides: Partial<PicaMobileCalendarProvider> = {}): World {
  const frames: string[] = [];
  const tasks: (() => Promise<void>)[] = [];
  let listener: ((event: PagesEvent) => void) | null = null;
  const host: PicaMobilePlansHost = {
    session: () => SESSION,
    isOpen: () => true,
    send: (frame) => {
      frames.push(frame);
      return true;
    },
    reject: vi.fn(),
    rejectUnauthenticated: vi.fn(),
    acknowledge: vi.fn(),
    endSession: vi.fn(),
    reportFailure: vi.fn(),
    enqueue: (task) => {
      tasks.push(task);
    },
  };
  const provider: PicaMobileCalendarProvider = {
    answer: vi.fn(() =>
      Promise.resolve({
        kind: "answer" as const,
        answer: {
          type: "calendar_target_options" as const,
          payload: { targets: [{ projectId: null, name: "Meine Termine" }] },
        },
      }),
    ),
    follow: vi.fn((next: (event: PagesEvent) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
    visibleChanges: vi.fn((_session: unknown, events: readonly PagesEvent[]) =>
      Promise.resolve({
        kind: "changes" as const,
        ids: events.map((event) => event.id),
      }),
    ),
    ...overrides,
  };
  return {
    handler: new PicaMobileCalendarHandler(provider, host),
    host,
    provider,
    frames,
    tasks,
    emit: (event) => listener?.(event),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("calendar handler", () => {
  it("answers a request with its answer frame", async () => {
    const { handler, host, frames } = world();
    await handler.handle(TARGETS);
    expect(host.acknowledge).toHaveBeenCalled();
    expect(frames.map((frame) => JSON.parse(frame))).toEqual([
      {
        version: 1,
        requestId: "t",
        type: "calendar_target_options",
        payload: { targets: [{ projectId: null, name: "Meine Termine" }] },
      },
    ]);
  });

  it("refuses with the code of the calendar", async () => {
    const { handler, host, frames } = world({
      answer: () =>
        Promise.resolve({
          kind: "refused",
          code: "not_found",
          message: "The event does not exist.",
        }),
    });
    await handler.handle(TARGETS);
    expect(frames).toEqual([]);
    expect(host.reject).toHaveBeenCalledWith({
      code: "not_found",
      message: "The event does not exist.",
      requestId: "t",
    });
  });

  it("ends the session and reports failures", async () => {
    const ended = world({
      answer: () => Promise.resolve({ kind: "sessionEnded" }),
    });
    await ended.handler.handle(TARGETS);
    expect(ended.host.endSession).toHaveBeenCalledWith("t");

    const failing = world({ answer: () => Promise.reject(new Error("db")) });
    await failing.handler.handle(TARGETS);
    expect(failing.host.reportFailure).toHaveBeenCalledWith(
      "t",
      expect.any(Error),
    );
  });

  it("treats requests as unknown without a provider and needs a session", async () => {
    const { host } = world();
    await new PicaMobileCalendarHandler(undefined, host).handle(TARGETS);
    expect(host.reject).toHaveBeenCalledWith(
      expect.objectContaining({ code: "unknown_type", requestId: "t" }),
    );

    const unauthenticated = world();
    const anonymous = { ...unauthenticated.host, session: () => null };
    await new PicaMobileCalendarHandler(
      unauthenticated.provider,
      anonymous,
    ).handle(TARGETS);
    expect(unauthenticated.host.rejectUnauthenticated).toHaveBeenCalledWith(
      "t",
    );
  });
});

describe("calendar change feed", () => {
  it("gathers changes and sends the visible ids once", async () => {
    vi.useFakeTimers();
    const { handler, frames, tasks, emit, provider } = world();
    handler.start();
    emit({ type: "calendar.changed", id: "event" });
    emit({ type: "calendar.changed", id: "event" });
    emit({ type: "ticket.updated", id: "due:t1" });
    await vi.advanceTimersByTimeAsync(300);
    expect(tasks).toHaveLength(1);
    await tasks[0]?.();
    expect(provider.visibleChanges).toHaveBeenCalledWith(SESSION, [
      { type: "calendar.changed", id: "event" },
      { type: "ticket.updated", id: "due:t1" },
    ]);
    expect(frames.map((frame) => JSON.parse(frame))).toEqual([
      {
        version: 1,
        requestId: null,
        type: "calendar_changed",
        payload: { ids: ["event", "due:t1"] },
      },
    ]);
  });

  it("sends nothing for invisible changes and ends an ended session", async () => {
    vi.useFakeTimers();
    const hidden = world({
      visibleChanges: () => Promise.resolve({ kind: "changes", ids: [] }),
    });
    hidden.handler.start();
    hidden.emit({ type: "calendar.changed", id: "event" });
    await vi.advanceTimersByTimeAsync(300);
    await hidden.tasks[0]?.();
    expect(hidden.frames).toEqual([]);

    const ended = world({
      visibleChanges: () => Promise.resolve({ kind: "sessionEnded" }),
    });
    ended.handler.start();
    ended.emit({ type: "calendar.changed", id: "event" });
    await vi.advanceTimersByTimeAsync(300);
    await ended.tasks[0]?.();
    expect(ended.host.endSession).toHaveBeenCalledWith(null);
  });

  it("stops hearing changes when the connection stops", async () => {
    vi.useFakeTimers();
    const { handler, tasks, emit } = world();
    handler.start();
    emit({ type: "calendar.changed", id: "event" });
    handler.stop();
    emit({ type: "calendar.changed", id: "other" });
    await vi.advanceTimersByTimeAsync(300);
    expect(tasks).toEqual([]);
  });
});
