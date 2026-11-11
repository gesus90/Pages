import { setTimeout as delay } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { CONSOLE_MAXIMUM_RETRIES } from "@/definition/RemoteConsole";

import {
  PATH,
  SSH_FAILURE,
  connectedConsole,
  createPty,
  createSession,
  settle,
  startConsole,
  states,
  targetOf,
} from "./remote-console-harness";

import type {
  RemoteConsoleSession,
  RemoteConsoleTarget,
} from "@/backend/service/remote/RemoteConsoleSession";
import type { FakeSession } from "./remote-console-harness";

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

describe("RemoteConsoleSession reconnecting an interrupted shell", () => {
  it("retries a lost transport after a delay and counts the attempt", async () => {
    const first = createPty();
    const second = createPty();
    const ptys = [first, second];
    const fake = createSession(() => {
      const next = ptys.shift();
      if (!next) throw new Error("No more terminals");
      return next.terminal;
    });
    const { console, events, target } = await connectedConsole(fake, first);

    first.exit(SSH_FAILURE);
    await settle();
    expect(console.view()).toMatchObject({
      status: "reconnecting",
      message: "remote.failure.transport_lost",
    });

    await vi.advanceTimersByTimeAsync(3000);
    second.firstOutput(true);
    await settle();

    expect(target).toHaveBeenCalledTimes(2);
    expect(console.view()).toMatchObject({
      status: "connected",
      attempts: 1,
      message: null,
    });
    expect(states(events).map((state) => state.status)).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "reconnecting",
      "connected",
    ]);
    // The second attempt is not a person's request.
    expect(fake.attemptNow).toHaveBeenCalledOnce();
  });

  it("does not schedule a second retry while one is pending", async () => {
    const first = createPty();
    const { console, target } = await connectedConsole(undefined, first);

    first.exit(SSH_FAILURE);
    await settle();
    console.reconnect();
    await vi.advanceTimersByTimeAsync(2000);

    expect(target).toHaveBeenCalledOnce();
  });

  it("retries a failing reconnect within the budget and then blocks", async () => {
    const first = createPty();
    const fake = createSession(() => first.terminal);
    let count = 0;
    const target = vi.fn(() => {
      count += 1;
      if (count === 1)
        return Promise.resolve({ session: fake.session, path: PATH });
      return Promise.reject(
        new RemoteError("remote_access_denied", "unreachable_network"),
      );
    });
    const { console } = startConsole({ target });
    await settle();
    first.firstOutput(true);
    await settle();

    first.exit(SSH_FAILURE);
    await settle();
    for (let attempt = 0; attempt < CONSOLE_MAXIMUM_RETRIES; attempt += 1)
      await vi.advanceTimersByTimeAsync(3000);

    expect(target).toHaveBeenCalledTimes(CONSOLE_MAXIMUM_RETRIES + 1);
    expect(console.view()).toMatchObject({
      status: "blocked",
      attempts: CONSOLE_MAXIMUM_RETRIES,
      message: "remote.failure.unreachable_network",
    });
  });
});

describe("RemoteConsoleSession reconnecting an interrupted shell, part 2", () => {
  it("blocks at once when the shell never connected before the transport failed", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const { console } = startConsole({ target: targetOf(fake) });
    await settle();

    pty.exit(SSH_FAILURE);
    await settle();

    expect(console.view()).toMatchObject({
      status: "blocked",
      message: "remote.failure.transport_lost",
    });
  });

  it("blocks when the transport fails after the budget is used up", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const { console } = startConsole({
      target: targetOf(fake),
      restored: { lastSequence: 0, attempts: CONSOLE_MAXIMUM_RETRIES },
    });
    await settle();
    pty.firstOutput(true);
    await settle();

    pty.exit(SSH_FAILURE);
    await settle();

    expect(console.view()).toMatchObject({
      status: "blocked",
      message: "remote.failure.transport_lost",
    });
  });

  it("ends with the exit code of a shell that a person left", async () => {
    const { console, pty } = await connectedConsole();

    pty.exit(3);
    await settle();

    expect(console.view()).toMatchObject({
      status: "ended",
      exitCode: 3,
      message: null,
    });
  });

  it("blocks with the unavailable terminal when the machine refused the PTY", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const { console } = startConsole({ target: targetOf(fake) });
    await settle();

    pty.refuse();
    pty.exit(SSH_FAILURE);
    await settle();

    expect(console.view()).toMatchObject({
      status: "blocked",
      message: "remote.console.ptyUnavailable",
    });
  });
});

describe("RemoteConsoleSession person's retry", () => {
  async function blockedConsole(
    failure: "host_key_changed" | "key_rejected",
  ): Promise<{
    readonly console: RemoteConsoleSession;
    readonly fake: FakeSession;
    readonly target: () => Promise<RemoteConsoleTarget>;
    readonly heal: () => void;
  }> {
    const fake = createSession(() => createPty().terminal);
    let isFailing = true;
    const target = vi.fn(() =>
      isFailing
        ? Promise.reject(new RemoteError("remote_access_denied", failure))
        : Promise.resolve({ session: fake.session, path: PATH }),
    );
    const started = startConsole({ target });
    await settle();
    return {
      console: started.console,
      fake,
      target,
      heal: () => {
        isFailing = false;
      },
    };
  }

  it("ignores a retry of a console that is not blocked", async () => {
    const { console, target } = await connectedConsole();

    console.reconnect();

    expect(console.view().status).toBe("connected");
    expect(target).toHaveBeenCalledOnce();
  });

  it("connects at once before any shell ran and spends one attempt", async () => {
    const { console, target, heal, fake } =
      await blockedConsole("key_rejected");
    heal();

    console.reconnect();

    expect(console.view()).toMatchObject({
      status: "connecting",
      attempts: 1,
      message: null,
    });
    await settle();
    expect(target).toHaveBeenCalledTimes(2);
    // Opening and retrying are both a person's request.
    expect(fake.attemptNow).toHaveBeenCalledOnce();
  });

  it("never retries a changed host key", async () => {
    const { console, target } = await blockedConsole("host_key_changed");

    console.reconnect();
    await settle();

    expect(console.view().status).toBe("blocked");
    expect(target).toHaveBeenCalledOnce();
  });

  it("cannot unblock a console whose ten attempts are used", async () => {
    const target = vi.fn(() =>
      Promise.reject(new RemoteError("remote_access_denied", "key_rejected")),
    );
    const { console } = startConsole({
      target,
      restored: { lastSequence: 0, attempts: CONSOLE_MAXIMUM_RETRIES },
    });
    await settle();

    console.reconnect();
    await settle();

    expect(console.view().status).toBe("blocked");
    expect(target).toHaveBeenCalledOnce();
  });
});

describe("RemoteConsoleSession person's retry, part 2", () => {
  it("schedules the shared retry when a shell ran before", async () => {
    const first = createPty();
    const fake = createSession(() => first.terminal);
    let count = 0;
    const target = vi.fn(() => {
      count += 1;
      return count === 1
        ? Promise.resolve({ session: fake.session, path: PATH })
        : Promise.reject(
            new RemoteError("remote_access_denied", "key_rejected"),
          );
    });
    const { console } = startConsole({ target });
    await settle();
    first.firstOutput(true);
    await settle();
    first.exit(SSH_FAILURE);
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(console.view()).toMatchObject({
      status: "blocked",
      message: "remote.failure.key_rejected",
      attempts: 1,
    });

    console.reconnect();

    expect(console.view()).toMatchObject({
      status: "reconnecting",
      message: "remote.failure.key_rejected",
    });
  });
});
