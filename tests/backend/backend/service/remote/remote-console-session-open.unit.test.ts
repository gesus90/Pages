import { setTimeout as delay } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { consoleMessageOf } from "@/backend/service/remote/RemoteConsoleSession";

import {
  PATH,
  SIZE,
  connectedConsole,
  createPty,
  createSession,
  settle,
  startConsole,
  states,
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

describe("consoleMessageOf", () => {
  it("classifies a failure, a code and an unknown error as translation keys", () => {
    expect(
      consoleMessageOf(new RemoteError("remote_access_denied", "host_unknown")),
    ).toBe("remote.failure.host_unknown");
    expect(consoleMessageOf(new RemoteError("remote_access_denied"))).toBe(
      "remote.error.remote_access_denied",
    );
    expect(consoleMessageOf(new Error("ssh said something secret"))).toBe(
      "remote.failure.remote_failed",
    );
  });
});

describe("RemoteConsoleSession opening a shell", () => {
  it("connects after the first output and reports the checked directory", async () => {
    const pty = createPty();
    const { console, events, fake } = await connectedConsole(undefined, pty);

    expect(fake.attemptNow).toHaveBeenCalledOnce();
    expect(fake.run).not.toHaveBeenCalled();
    expect(fake.openPty).toHaveBeenCalledWith(
      expect.objectContaining({ ...SIZE, path: PATH, command: null }),
    );
    expect(pty.resize).toHaveBeenCalledWith(80, 24);
    expect(console.view()).toEqual({
      status: "connected",
      attempts: 0,
      message: null,
      exitCode: null,
      directory: PATH,
      setup: null,
    });
    expect(states(events).map((state) => state.status)).toEqual([
      "connecting",
      "connected",
    ]);
  });

  it("reads the login directory over its own command when no path is given", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    fake.run.mockResolvedValue({
      stdout: "Welcome\n/home/me\n",
      stderr: "",
      exitCode: 0,
    });

    const { console } = await connectedConsole(fake, pty, { path: null });

    expect(fake.run).toHaveBeenCalledWith("pwd", 15_000);
    expect(console.view().directory).toBe("/home/me");
  });

  it.each([
    { name: "a failed command", stdout: "/home/me\n", exitCode: 1 },
    { name: "output without a path", stdout: "Welcome\n", exitCode: 0 },
    { name: "an overlong path", stdout: `/${"a".repeat(4096)}\n`, exitCode: 0 },
  ])("reports no directory after $name", async ({ stdout, exitCode }) => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    fake.run.mockResolvedValue({ stdout, exitCode, stderr: "" });

    const { console } = await connectedConsole(fake, pty, { path: null });

    expect(console.view()).toMatchObject({
      status: "connected",
      directory: null,
    });
  });

  it("treats a silent shell as ready once the first-output timeout passed", async () => {
    vi.mocked(delay).mockResolvedValueOnce(true);
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const { console } = startConsole({ target: targetOf(fake) });

    await settle();

    expect(console.view().status).toBe("connected");
    expect(delay).toHaveBeenCalledWith(5000, true, { ref: false });
  });

  it("stays connecting when the shell ended before it printed anything", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const { console } = startConsole({ target: targetOf(fake) });
    await settle();

    pty.firstOutput(false);
    await settle();

    expect(console.view().status).toBe("connecting");
  });
});

describe("RemoteConsoleSession opening a shell, part 2", () => {
  it("passes the geometry on a resize that arrives while connecting", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const { console } = startConsole({ target: targetOf(fake) });

    console.resize({ columns: 120, rows: 40 });
    await settle();

    expect(pty.resize).toHaveBeenLastCalledWith(120, 40);
    console.resize({ columns: 100, rows: 30 });
    expect(pty.resize).toHaveBeenLastCalledWith(100, 30);
    expect(console.progress().size).toEqual({ columns: 100, rows: 30 });
  });

  it("splits remote output into frames of at most 8192 characters", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const { events } = startConsole({ target: targetOf(fake) });
    await settle();
    const request = fake.openPty.mock.calls[0]?.[0];

    request?.onOutput("x".repeat(8192 * 2 + 5));

    const chunks = events.flatMap((event) =>
      event.kind === "output" ? [event.chunk.length] : [],
    );
    expect(chunks).toEqual([8192, 8192, 5]);
  });
});

describe("RemoteConsoleSession input", () => {
  it("writes input of the current attempt to the terminal", async () => {
    const { console, pty } = await connectedConsole();

    console.write("ls\n", 0);

    expect(pty.write).toHaveBeenCalledWith("ls\n");
  });

  it("refuses input while no shell is connected", async () => {
    const pty = createPty();
    const fake = createSession(() => pty.terminal);
    const { console } = startConsole({ target: targetOf(fake) });

    expect(() => console.write("ls", 0)).toThrow(RemoteError);
    await settle();
    expect(pty.write).not.toHaveBeenCalled();
  });

  it("refuses input that belongs to an earlier attempt", async () => {
    const { console, pty } = await connectedConsole();

    expect(() => console.write("ls", 1)).toThrow(
      expect.objectContaining({ code: "remote_transport_lost" }),
    );
    expect(pty.write).not.toHaveBeenCalled();
  });
});
