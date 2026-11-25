import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveChangeHub } from "./LiveChangeHub";

import type { LiveAccount } from "./LiveChangeHub";
import type { LiveChangeAudience } from "./LiveChangeAudience";
import type { PagesEvent } from "./PagesEventPublisher";
import type { User } from "@/definition/User";

const logger = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logger);

const decoder = new TextDecoder();
const user = { id: "u" } as unknown as User;

interface Harness {
  hub: LiveChangeHub;
  abort: AbortController;
  chunks: string[];
  pumping: Promise<void>;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  emit: (event: PagesEvent) => void;
}

function setup(
  account: () => Promise<LiveAccount | null>,
  version = "v1",
): Harness {
  let listener: (event: PagesEvent) => void = () => undefined;
  const notice = vi.fn((...call: [User, PagesEvent]) =>
    Promise.resolve(
      call[1].id === "hidden"
        ? null
        : { kind: "ticket" as const, id: call[1].id },
    ),
  );
  const hub = new LiveChangeHub(
    {
      subscribe: (next) => {
        listener = next;
        return () => undefined;
      },
    },
    { notice } as unknown as Pick<
      LiveChangeAudience,
      "notice"
    > as LiveChangeAudience,
  );
  const abort = new AbortController();
  const stream = hub.open({ account, version, signal: abort.signal });
  const reader = stream.getReader();
  const chunks: string[] = [];
  const pump = async (): Promise<void> => {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      chunks.push(decoder.decode(next.value));
    }
  };
  const pumping = pump();
  return {
    hub,
    abort,
    chunks,
    pumping,
    reader,
    emit: (event: PagesEvent) => listener(event),
  };
}

const active =
  (version = "v1") =>
  (): Promise<LiveAccount> =>
    Promise.resolve({ user, version });

describe("LiveChangeHub", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logger.logCaughtError.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the retry hint and delivers each notice once", async () => {
    const { chunks, emit, abort } = setup(active());
    emit({ type: "ticket.updated", id: "a" });
    emit({ type: "ticket.updated", id: "a" });
    emit({ type: "ticket.changed", id: "a" });
    emit({ type: "ticket.updated", id: "hidden" });
    await vi.advanceTimersByTimeAsync(60);
    expect(chunks[0]).toBe("retry: 3000\n\n");
    const changes = chunks.filter((chunk) => chunk.startsWith("event: change"));
    expect(changes).toHaveLength(1);
    abort.abort();
  });

  it("sends resync on a changed version, a resync event and resyncAll", async () => {
    let version = "v1";
    const { chunks, emit, hub, abort } = setup(() =>
      Promise.resolve({ user, version }),
    );
    await vi.advanceTimersByTimeAsync(60);
    version = "v2";
    emit({ type: "wiki.page.purged", id: "w" });
    await vi.advanceTimersByTimeAsync(60);
    hub.resyncAll();
    await vi.advanceTimersByTimeAsync(60);
    const resyncs = chunks.filter((chunk) => chunk.startsWith("event: resync"));
    expect(resyncs).toHaveLength(2);
    abort.abort();
  });

  it("turns an overflow of waiting events into a resync", async () => {
    const { chunks, emit, abort } = setup(active());
    await vi.advanceTimersByTimeAsync(60);
    for (let index = 0; index < 257; index += 1)
      emit({ type: "ticket.updated", id: `t${index}` });
    await vi.advanceTimersByTimeAsync(60);
    expect(chunks.some((chunk) => chunk.startsWith("event: resync"))).toBe(
      true,
    );
    abort.abort();
  });

  it("sends a keep-alive and rechecks the account", async () => {
    const account = vi.fn(active());
    const { chunks, abort } = setup(account);
    await vi.advanceTimersByTimeAsync(60);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(chunks).toContain(": keep-alive\n\n");
    expect(account).toHaveBeenCalledTimes(2);
    abort.abort();
  });
});

describe("LiveChangeHub closing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logger.logCaughtError.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes when the session ended", async () => {
    const { hub, pumping } = setup(() => Promise.resolve(null));
    await vi.advanceTimersByTimeAsync(60);
    await pumping;
    hub.receive({ type: "ticket.updated", id: "a" });
    hub.resyncAll();
  });

  it("closes and logs when the account read fails", async () => {
    const failure = new Error("down");
    const { pumping } = setup(() => Promise.reject(failure));
    await vi.advanceTimersByTimeAsync(60);
    await pumping;
    expect(logger.logCaughtError).toHaveBeenCalledWith(
      "LiveChangeHub",
      failure,
    );
  });

  it("closes on abort, also one that came before the start", async () => {
    const first = setup(active());
    first.abort.abort();
    await first.pumping;
    const hub = new LiveChangeHub({ subscribe: () => () => undefined }, {
      notice: vi.fn(),
    } as unknown as LiveChangeAudience);
    const signal = AbortSignal.abort();
    const reader = hub
      .open({ account: active(), version: "v1", signal })
      .getReader();
    expect((await reader.read()).done).toBe(false);
    expect((await reader.read()).done).toBe(true);
  });

  it("closes when the reader cancels and tolerates a second close", async () => {
    const { reader, pumping } = setup(active());
    await reader.cancel();
    await pumping;
  });

  it("drops a reader that falls behind", async () => {
    const hub = new LiveChangeHub({ subscribe: () => () => undefined }, {
      notice: vi.fn(),
    } as unknown as LiveChangeAudience);
    const abort = new AbortController();
    const reader = hub
      .open({ account: active(), version: "v1", signal: abort.signal })
      .getReader();
    // Nobody reads: the keep-alive frames fill the 64 slots, then the stream drops.
    await vi.advanceTimersByTimeAsync(25_000 * 70);
    let done = false;
    for (let index = 0; index < 80 && !done; index += 1)
      done = (await reader.read()).done === true;
    expect(done).toBe(true);
  });

  it("logs a controller that cannot close any more", async () => {
    const { abort, reader, pumping } = setup(active());
    await reader.cancel();
    abort.abort();
    await pumping;
  });

  it("collects events that arrive while a round is still running", async () => {
    let release: (account: LiveAccount) => void = () => undefined;
    let calls = 0;
    const { chunks, emit, abort } = setup(() => {
      calls += 1;
      if (calls > 1) return Promise.resolve({ user, version: "v1" });
      return new Promise<LiveAccount>((resolve) => {
        release = resolve;
      });
    });
    await vi.advanceTimersByTimeAsync(60);
    emit({ type: "ticket.updated", id: "late" });
    await vi.advanceTimersByTimeAsync(60);
    release({ user, version: "v1" });
    await vi.advanceTimersByTimeAsync(120);
    expect(
      chunks.filter((chunk) => chunk.startsWith("event: change")),
    ).toHaveLength(1);
    abort.abort();
  });

  it("stops writing when the stream closes during a round", async () => {
    let release: (account: LiveAccount) => void = () => undefined;
    const { chunks, emit, abort } = setup(
      () =>
        new Promise<LiveAccount>((resolve) => {
          release = resolve;
        }),
    );
    emit({ type: "ticket.updated", id: "a" });
    await vi.advanceTimersByTimeAsync(60);
    abort.abort();
    release({ user, version: "v2" });
    await vi.advanceTimersByTimeAsync(60);
    expect(chunks.some((chunk) => chunk.startsWith("event:"))).toBe(false);
  });
});
