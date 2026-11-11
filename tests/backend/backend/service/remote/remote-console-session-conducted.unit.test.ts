import { setTimeout as delay } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  PROGRESS,
  SSH_FAILURE,
  createConductor,
  createPty,
  createSession,
  deferred,
  settle,
  startConsole,
  targetOf,
} from "./remote-console-harness";

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

describe("RemoteConsoleSession conducted command", () => {
  it("runs the conductor command and shows its filtered output", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const conducted = createConductor();
    const { events } = startConsole({
      target: targetOf(fake, { conductor: conducted.conductor }),
    });
    await settle();

    fake.openPty.mock.calls[0]?.[0].onOutput("installing");

    expect(fake.openPty).toHaveBeenCalledWith(
      expect.objectContaining({ command: "runner-setup --yes" }),
    );
    expect(conducted.prepare).toHaveBeenCalledOnce();
    expect(conducted.terminalOpened).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "output", chunk: "INSTALLING" }),
    );
  });

  it("shows the progress of the conductor and lets it type into the terminal", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const conducted = createConductor();
    const { console } = startConsole({
      target: targetOf(fake, { conductor: conducted.conductor }),
    });
    await settle();

    conducted.control().report(PROGRESS);
    conducted.control().write("yes\n");

    expect(console.view().setup).toBe(PROGRESS);
    expect(pty.write).toHaveBeenCalledWith("yes\n");
  });

  it("verifies the result before the console ends and ignores input meanwhile", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const conducted = createConductor();
    const finishing = deferred<void>();
    conducted.finish.mockReturnValue(finishing.promise);
    const { console } = startConsole({
      target: targetOf(fake, { conductor: conducted.conductor }),
    });
    await settle();
    pty.firstOutput(true);
    await settle();

    pty.exit(0);
    await settle();
    console.write("late input", 0);

    expect(pty.write).not.toHaveBeenCalled();
    expect(conducted.finish).toHaveBeenCalledWith(
      { exitCode: 0, isTransportFailure: false },
      conducted.control(),
    );
    expect(console.view().status).toBe("connected");

    finishing.resolve();
    await settle();
    expect(console.view()).toMatchObject({ status: "ended", exitCode: 0 });
  });
});

describe("RemoteConsoleSession conducted command, part 2", () => {
  it("never starts a conducted command a second time after a lost transport", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const conducted = createConductor();
    const { console } = startConsole({
      target: targetOf(fake, { conductor: conducted.conductor }),
    });
    await settle();
    pty.firstOutput(true);
    await settle();

    pty.exit(SSH_FAILURE);
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(conducted.finish).toHaveBeenCalledWith(
      { exitCode: SSH_FAILURE, isTransportFailure: true },
      expect.anything(),
    );
    expect(console.view()).toMatchObject({
      status: "blocked",
      message: "remote.failure.transport_lost",
    });
    expect(fake.openPty).toHaveBeenCalledOnce();
  });

  it("still ends the console when the conductor fails to verify", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const conducted = createConductor();
    const error = new Error("verification broke");
    conducted.finish.mockRejectedValue(error);
    const { console } = startConsole({
      target: targetOf(fake, { conductor: conducted.conductor }),
    });
    await settle();

    pty.exit(2);
    await settle();

    expect(logCaughtError).toHaveBeenCalledWith("RemoteConsoleSession", error);
    expect(console.view()).toMatchObject({ status: "ended", exitCode: 2 });
  });

  it("reports nothing when the console was closed while the conductor verified", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const conducted = createConductor();
    const finishing = deferred<void>();
    conducted.finish.mockReturnValue(finishing.promise);
    const { console } = startConsole({
      target: targetOf(fake, { conductor: conducted.conductor }),
    });
    await settle();
    pty.exit(0);
    await settle();

    console.close("closed");
    finishing.resolve();
    await settle();

    expect(console.view()).toMatchObject({
      status: "ended",
      message: "closed",
      exitCode: null,
    });
  });

  it("ignores progress that arrives after the console ended", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const conducted = createConductor();
    const { console } = startConsole({
      target: targetOf(fake, { conductor: conducted.conductor }),
    });
    await settle();
    console.close();

    conducted.control().report(PROGRESS);

    expect(console.view().setup).toBeNull();
  });
});

describe("RemoteConsoleSession conducted command, part 3", () => {
  it("lets the conductor abort a run that failed before the terminal", async () => {
    const conducted = createConductor();
    const error = new RemoteError("remote_access_denied", "key_rejected");
    conducted.prepare.mockRejectedValue(error);
    const fake = createSession(() => createPty().terminal);
    const { console } = startConsole({
      target: targetOf(fake, { conductor: conducted.conductor }),
    });
    await settle();

    expect(conducted.abort).toHaveBeenCalledWith(error, expect.anything());
    expect(fake.openPty).not.toHaveBeenCalled();
    expect(console.view()).toMatchObject({
      status: "blocked",
      message: "remote.failure.key_rejected",
    });
  });

  it("does not retry a conducted command that already started", async () => {
    const conducted = createConductor();
    conducted.prepare.mockRejectedValue(
      new RemoteError("remote_access_denied", "key_rejected"),
    );
    const fake = createSession(() => createPty().terminal);
    const { console } = startConsole({
      target: targetOf(fake, { conductor: conducted.conductor }),
    });
    await settle();
    conducted.hasStarted = true;

    console.reconnect();

    expect(console.view().status).toBe("blocked");
    expect(conducted.prepare).toHaveBeenCalledOnce();
  });

  it("may retry a conducted command that did not start", async () => {
    const conducted = createConductor();
    conducted.prepare.mockRejectedValueOnce(
      new RemoteError("remote_access_denied", "key_rejected"),
    );
    const fake = createSession(() => createPty().terminal);
    const { console } = startConsole({
      target: targetOf(fake, { conductor: conducted.conductor }),
    });
    await settle();

    console.reconnect();
    await settle();

    expect(conducted.prepare).toHaveBeenCalledTimes(2);
    expect(fake.openPty).toHaveBeenCalledOnce();
    expect(console.view().attempts).toBe(1);
  });
});
