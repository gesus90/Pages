import { setTimeout as delay } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { RemoteConsoleSession } from "@/backend/service/remote/RemoteConsoleSession";

import {
  PATH,
  SIZE,
  SSH_FAILURE,
  connectedConsole,
  createPty,
  createSession,
  deferred,
  lastState,
  settle,
  startConsole,
  targetOf,
} from "./remote-console-harness";

import type { SshPty } from "@/backend/remote/SshPty";
import type { RemoteConsoleTarget } from "@/backend/service/remote/RemoteConsoleSession";

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

describe("RemoteConsoleSession close", () => {
  it("terminates the shell, ends the console and keeps the message", async () => {
    const { console, pty, events } = await connectedConsole();

    console.close("remote.error.gone");

    expect(pty.close).toHaveBeenCalledOnce();
    expect(console.view()).toMatchObject({
      status: "ended",
      message: "remote.error.gone",
    });
    expect(lastState(events).status).toBe("ended");
  });

  it("is idempotent once ended", async () => {
    const { console, pty, events } = await connectedConsole();
    console.close();
    const count = events.length;

    console.close("later");

    expect(pty.close).toHaveBeenCalledOnce();
    expect(events).toHaveLength(count);
    expect(console.view().message).toBeNull();
  });

  it("cancels a pending retry", async () => {
    const first = createPty();
    const { console, target } = await connectedConsole(undefined, first);
    first.exit(SSH_FAILURE);
    await settle();

    console.close();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(target).toHaveBeenCalledOnce();
    expect(console.view().status).toBe("ended");
  });

  it("opens nothing when closed while the target is still resolving", async () => {
    const resolving = deferred<RemoteConsoleTarget>();
    const fake = createSession(() => createPty().terminal);
    const console = new RemoteConsoleSession(() => resolving.promise, SIZE);

    console.close();
    resolving.resolve({ session: fake.session, path: PATH });
    await settle();

    expect(fake.attemptNow).not.toHaveBeenCalled();
    expect(fake.openPty).not.toHaveBeenCalled();
  });

  it("closes a terminal that finished opening after the console was closed", async () => {
    const pty = createPty();
    const opening = deferred<SshPty>();
    const fake = createSession(() => opening.promise);
    const { console } = startConsole({ target: targetOf(fake) });
    await settle();

    console.close();
    opening.resolve(pty.terminal);
    await settle();

    expect(pty.close).toHaveBeenCalledOnce();
    expect(console.view().status).toBe("ended");
  });

  it("stays quiet about a failure that arrives after the console was closed", async () => {
    const failing = deferred<RemoteConsoleTarget>();
    const console = new RemoteConsoleSession(() => failing.promise, SIZE);

    console.close();
    failing.reject(new RemoteError("remote_access_denied", "host_unknown"));
    await settle();

    expect(console.view().status).toBe("ended");
  });

  it("ignores the exit of a shell of an earlier generation", async () => {
    const { console, pty } = await connectedConsole();

    console.close();
    pty.exit(7);
    await settle();

    expect(console.view()).toMatchObject({ status: "ended", exitCode: null });
  });
});

describe("RemoteConsoleSession close, part 2", () => {
  it("does not report connected when the console closed during the first output wait", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const { console } = startConsole({ target: targetOf(fake) });
    await settle();

    console.close();
    pty.firstOutput(true);
    await settle();

    expect(console.view().status).toBe("ended");
  });
});
