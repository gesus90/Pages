import { setTimeout as delay } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  connectedConsole,
  createPty,
  createSession,
  lastState,
  settle,
  startConsole,
  targetOf,
} from "./remote-console-harness";

import type { RemoteConsoleEvent } from "@/definition/RemoteConsole";

vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(() => new Promise<boolean>(() => undefined)),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(delay).mockClear();
  vi.mocked(logCaughtError).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RemoteConsoleSession replay", () => {
  it("starts a restored console with a gap and counts on from the stored number", () => {
    const fake = createSession(() => createPty().terminal);
    const { console, events } = startConsole({
      target: targetOf(fake),
      restored: { lastSequence: 41, attempts: 3 },
    });

    expect(console.view().attempts).toBe(3);
    expect(events[0]).toEqual({ kind: "gap", sequence: 42 });
    expect(console.progress().lastSequence).toBe(42);
  });

  it("replays only events after the cursor and then follows live output", async () => {
    const { console, fake } = await connectedConsole();
    const request = fake.openPty.mock.calls[0]?.[0];
    request?.onOutput("one");
    const seen: RemoteConsoleEvent[] = [];

    const stop = console.follow(1, (event) => seen.push(event));
    request?.onOutput("two");
    stop();
    request?.onOutput("three");

    expect(seen.map((event) => event.kind)).toEqual([
      "output",
      "state",
      "output",
    ]);
    expect(seen[0]).toMatchObject({ chunk: "one", sequence: 2 });
    expect(seen[2]).toMatchObject({ chunk: "two" });
  });

  it("continues after a browser cursor that is ahead of the console with a gap", async () => {
    const { console } = await connectedConsole();
    const seen: RemoteConsoleEvent[] = [];

    console.follow(100, (event) => seen.push(event));

    expect(seen[0]).toEqual({ kind: "gap", sequence: 101 });
    expect(console.progress().lastSequence).toBe(101);
  });

  it("does not follow a cursor beyond the exact integer range", async () => {
    const { console } = await connectedConsole();
    const before = console.progress().lastSequence;

    console.follow(Number.MAX_SAFE_INTEGER, () => undefined);

    expect(console.progress().lastSequence).toBe(before);
  });

  it("reports output that the bounded history dropped as a gap", async () => {
    const { console, fake } = await connectedConsole();
    const request = fake.openPty.mock.calls[0]?.[0];
    for (let index = 0; index < 40; index += 1)
      request?.onOutput("y".repeat(8192));
    const seen: RemoteConsoleEvent[] = [];

    console.replay(2, (event) => seen.push(event));

    expect(seen[0]).toMatchObject({ kind: "gap" });
    expect(seen[0]?.sequence).toBeGreaterThan(2);
    expect(seen.slice(1).every((event) => event.kind === "output")).toBe(true);
    const dropped = seen[0]?.sequence ?? 0;
    expect(seen[1]?.sequence).toBe(dropped + 1);
  });
});

describe("RemoteConsoleSession failures before a shell ran", () => {
  it("blocks with the classified message of a refused connection", async () => {
    const { events } = startConsole({
      target: () =>
        Promise.reject(
          new RemoteError("remote_access_denied", "unreachable_timeout"),
        ),
    });
    await settle();

    expect(lastState(events)).toMatchObject({
      status: "blocked",
      message: "remote.failure.unreachable_timeout",
    });
  });

  it("blocks with the unavailable terminal when the local PTY cannot start", async () => {
    const error = new Error("spawn failed");
    const fake = createSession(() => Promise.reject(error));
    const { console } = startConsole({ target: targetOf(fake) });
    await settle();

    expect(console.view()).toMatchObject({
      status: "blocked",
      message: "remote.console.ptyUnavailable",
    });
    expect(logCaughtError).toHaveBeenCalledWith("RemoteConsoleSession", error);
  });

  it("keeps a classified error of opening the terminal as it is", async () => {
    const fake = createSession(() =>
      Promise.reject(new RemoteError("remote_access_denied", "key_rejected")),
    );
    const { console } = startConsole({ target: targetOf(fake) });
    await settle();

    expect(console.view().message).toBe("remote.failure.key_rejected");
    expect(logCaughtError).not.toHaveBeenCalled();
  });

  it("closes the opened terminal when reading the login directory fails", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    fake.run.mockRejectedValue(new RemoteError("remote_transport_lost"));
    const { console } = startConsole({
      target: targetOf(fake, { path: null }),
    });
    await settle();

    expect(pty.close).toHaveBeenCalledOnce();
    expect(console.view()).toMatchObject({
      status: "blocked",
      message: "remote.error.remote_transport_lost",
    });
  });

  it("does not leave an unhandled rejection when both the read and the terminal fail", async () => {
    const fake = createSession(() => Promise.reject(new Error("no pty")));
    fake.run.mockRejectedValue(new RemoteError("remote_transport_lost"));
    const { console } = startConsole({
      target: targetOf(fake, { path: null }),
    });
    await settle();

    expect(console.view().message).toBe("remote.error.remote_transport_lost");
  });

  it("is never retried on its own, even for a reconnecting failure", async () => {
    const { console } = startConsole({
      target: () =>
        Promise.reject(new RemoteError("remote_access_denied", "host_unknown")),
    });
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(console.view()).toMatchObject({ status: "blocked", attempts: 0 });
  });
});
