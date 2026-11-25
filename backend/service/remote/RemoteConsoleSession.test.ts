import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";

import { RemoteConsoleSession, consoleMessageOf } from "./RemoteConsoleSession";

import type { RemoteSession } from "@/backend/remote/RemoteSession";
import type { SshPty } from "@/backend/remote/SshPty";
import type {
  ConductorControl,
  RemoteConsoleConductor,
} from "./RemoteConsoleConductor";
import type { RemoteConsoleTarget } from "./RemoteConsoleSession";
import type { RemoteConsoleEvent } from "@/definition/RemoteConsole";
import type { SetupProgress } from "@/definition/RemoteSetup";

const timers = vi.hoisted(() => ({
  setTimeout: vi.fn(
    async (): Promise<boolean> => new Promise<boolean>(() => undefined),
  ),
}));

vi.mock("node:timers/promises", () => timers);
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

interface FakePty {
  readonly pty: SshPty;
  readonly write: ReturnType<typeof vi.fn>;
  readonly resize: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly wasRefused: ReturnType<typeof vi.fn>;
  exit(code: number): void;
  first(isShell: boolean): void;
}

function ptyOf(): FakePty {
  let exit: (code: number) => void = () => undefined;
  let first: (isShell: boolean) => void = () => undefined;
  const write = vi.fn();
  const resize = vi.fn();
  const close = vi.fn();
  const wasRefused = vi.fn(() => false);
  const fake = {
    write,
    resize,
    close,
    wasRefused,
    exited: new Promise<number>((resolve) => {
      exit = resolve;
    }),
    firstOutput: new Promise<boolean>((resolve) => {
      first = resolve;
    }),
  };
  // The double implements exactly the members the console uses.
  return {
    pty: fake as unknown as SshPty,
    write,
    resize,
    close,
    wasRefused,
    exit,
    first,
  };
}

interface OpenRequest {
  onOutput(chunk: string): void;
}

interface Rig {
  readonly fake: FakePty;
  readonly run: ReturnType<typeof vi.fn>;
  readonly openPty: Mock<(request: OpenRequest) => Promise<SshPty>>;
  readonly attemptNow: Mock<() => Promise<undefined>>;
  readonly target: RemoteConsoleTarget;
  readonly requests: OpenRequest[];
}

function rigOf(
  options: {
    path?: string | null;
    conductor?: RemoteConsoleConductor;
    stdout?: string;
    exitCode?: number;
  } = {},
): Rig {
  const fake = ptyOf();
  const requests: Rig["requests"] = [];
  const run = vi.fn(async () => ({
    stdout: options.stdout ?? "/home/me\n",
    stderr: "",
    exitCode: options.exitCode ?? 0,
  }));
  const openPty = vi.fn(async (request: OpenRequest) => {
    requests.push(request);
    return fake.pty;
  });
  const attemptNow = vi.fn(async () => undefined);
  const session = { run, openPty, attemptNow } as unknown as RemoteSession;
  const target: RemoteConsoleTarget = {
    session,
    path: options.path === undefined ? "/work" : options.path,
    conductor: options.conductor,
  };
  return { fake, run, openPty, attemptNow, target, requests };
}

function conductorOf(
  overrides: Partial<RemoteConsoleConductor> = {},
): RemoteConsoleConductor & { control: ConductorControl[] } {
  const control: ConductorControl[] = [];
  return {
    command: "setup",
    control,
    hasStarted: vi.fn(() => false),
    prepare: vi.fn(async (c: ConductorControl) => {
      control.push(c);
    }),
    terminalOpened: vi.fn(),
    filter: vi.fn((chunk: string) => chunk.toUpperCase()),
    finish: vi.fn(async () => undefined),
    abort: vi.fn(),
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

const size = { columns: 80, rows: 24 };
const progress: SetupProgress = {
  phases: [],
  step: null,
  outcome: null,
  reason: null,
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function collect(session: RemoteConsoleSession): RemoteConsoleEvent[] {
  const events: RemoteConsoleEvent[] = [];
  session.follow(0, (event) => events.push(event));
  return events;
}

beforeEach(() => {
  vi.useFakeTimers();
  timers.setTimeout.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("consoleMessageOf", () => {
  it("classifies remote errors and unknown errors", () => {
    expect(consoleMessageOf(new Error("x"))).toBe(
      "remote.failure.remote_failed",
    );
    expect(consoleMessageOf(new RemoteError("remote_blocked"))).toBe(
      "remote.error.remote_blocked",
    );
    expect(
      consoleMessageOf(new RemoteError("remote_blocked", "host_unknown")),
    ).toBe("remote.failure.host_unknown");
  });
});

describe("RemoteConsoleSession connecting", () => {
  it("connects a shell in a fixed directory and relays output", async () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size);
    const events = collect(session);
    await settle();
    expect(rig.attemptNow).toHaveBeenCalledTimes(1);
    rig.requests[0]?.onOutput("a".repeat(9000));
    rig.fake.first(true);
    await settle();
    expect(session.view()).toMatchObject({
      status: "connected",
      directory: "/work",
    });
    const chunks = events.filter((event) => event.kind === "output");
    expect(chunks).toHaveLength(2);
    expect(rig.fake.resize).toHaveBeenCalledWith(80, 24);
    session.write("ls", 0);
    expect(rig.fake.write).toHaveBeenCalledWith("ls");
    expect(() => session.write("x", 3)).toThrow(RemoteError);
    session.resize({ columns: 100, rows: 30 });
    expect(rig.fake.resize).toHaveBeenLastCalledWith(100, 30);
    expect(session.progress().size).toEqual({ columns: 100, rows: 30 });
  });

  it("reads the login directory with the last absolute line", async () => {
    const rig = rigOf({ path: null, stdout: "banner\n /a \n/home/me\nend\n" });
    const session = new RemoteConsoleSession(async () => rig.target, size);
    rig.fake.first(true);
    await settle();
    expect(session.view().directory).toBe("/home/me");
  });

  it("falls back to no directory for failures and long paths", async () => {
    const failed = rigOf({ path: null, exitCode: 1 });
    const one = new RemoteConsoleSession(async () => failed.target, size);
    failed.fake.first(true);
    await settle();
    expect(one.view().directory).toBeNull();
    const long = rigOf({ path: null, stdout: `/${"a".repeat(5000)}` });
    const two = new RemoteConsoleSession(async () => long.target, size);
    long.fake.first(true);
    await settle();
    expect(two.view().directory).toBeNull();
    const empty = rigOf({ path: null, stdout: "nothing" });
    const three = new RemoteConsoleSession(async () => empty.target, size);
    empty.fake.first(true);
    await settle();
    expect(three.view().directory).toBeNull();
  });
});

describe("RemoteConsoleSession connection failures", () => {
  it("stays connecting while the shell is silent or refused output", async () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size);
    rig.fake.first(false);
    await settle();
    expect(session.view().status).toBe("connecting");
  });

  it("treats a silent shell as ready after the timeout", async () => {
    timers.setTimeout.mockImplementationOnce(async () => true);
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size);
    await settle();
    expect(session.view().status).toBe("connected");
  });

  it("reports an unavailable terminal for non-remote open errors", async () => {
    const rig = rigOf();
    rig.openPty.mockRejectedValueOnce(new Error("native"));
    const session = new RemoteConsoleSession(async () => rig.target, size);
    await settle();
    expect(session.view().message).toBe("remote.console.ptyUnavailable");
    rig.openPty.mockRejectedValueOnce(new RemoteError("remote_blocked"));
    session.reconnect();
    await settle();
    expect(session.view().message).toBe("remote.error.remote_blocked");
  });

  it("closes the opened terminal when the directory read fails", async () => {
    const rig = rigOf({ path: null });
    rig.run.mockRejectedValueOnce(new RemoteError("remote_blocked"));
    const session = new RemoteConsoleSession(async () => rig.target, size);
    await settle();
    expect(rig.fake.close).toHaveBeenCalled();
    expect(session.view().status).toBe("blocked");
  });

  it("copes with a refused terminal while the directory read fails", async () => {
    const rig = rigOf({ path: null });
    rig.run.mockRejectedValueOnce(new RemoteError("remote_blocked"));
    rig.openPty.mockRejectedValueOnce(new RemoteError("remote_blocked"));
    const session = new RemoteConsoleSession(async () => rig.target, size);
    await settle();
    expect(session.view().status).toBe("blocked");
  });
});

describe("RemoteConsoleSession generations", () => {
  it("ignores a target that resolves after close", async () => {
    const rig = rigOf();
    const pending = deferred<RemoteConsoleTarget>();
    const session = new RemoteConsoleSession(() => pending.promise, size);
    session.close();
    pending.resolve(rig.target);
    await settle();
    expect(rig.openPty).not.toHaveBeenCalled();
  });

  it("ignores a failure that arrives after close", async () => {
    const pending = deferred<RemoteConsoleTarget>();
    const session = new RemoteConsoleSession(() => pending.promise, size);
    session.close();
    pending.reject(new Error("late"));
    await settle();
    expect(session.view().status).toBe("ended");
  });

  it("stops after close while the session hurries", async () => {
    const rig = rigOf();
    const pending = deferred<undefined>();
    rig.attemptNow.mockImplementationOnce(() => pending.promise);
    const session = new RemoteConsoleSession(async () => rig.target, size);
    await settle();
    session.close();
    pending.resolve(undefined);
    await settle();
    expect(rig.openPty).not.toHaveBeenCalled();
  });

  it("stops after close while the conductor prepares", async () => {
    const pending = deferred<void>();
    const conductor = conductorOf({ prepare: vi.fn(() => pending.promise) });
    const rig = rigOf({ conductor });
    const session = new RemoteConsoleSession(async () => rig.target, size);
    await settle();
    session.close();
    pending.resolve();
    await settle();
    expect(rig.openPty).not.toHaveBeenCalled();
  });

  it("closes a terminal that opened after close", async () => {
    const rig = rigOf();
    const pending = deferred<SshPty>();
    rig.openPty.mockImplementationOnce(() => pending.promise);
    const session = new RemoteConsoleSession(async () => rig.target, size);
    await settle();
    session.close();
    pending.resolve(rig.fake.pty);
    await settle();
    expect(rig.fake.close).toHaveBeenCalled();
  });

  it("does not report connected when closed while waiting for output", async () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size);
    await settle();
    session.close();
    rig.fake.first(true);
    await settle();
    expect(session.view().status).toBe("ended");
  });
});

describe("RemoteConsoleSession events", () => {
  it("starts a restored console with a gap", () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size, {
      lastSequence: 7,
      attempts: 2,
    });
    const events = collect(session);
    expect(events[0]).toEqual({ kind: "gap", sequence: 8 });
    expect(session.view().attempts).toBe(2);
  });

  it("continues after a browser cursor that is ahead", () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size);
    const events: RemoteConsoleEvent[] = [];
    session.follow(50, (event) => events.push(event));
    expect(events[0]).toEqual({ kind: "gap", sequence: 51 });
    const huge: RemoteConsoleEvent[] = [];
    session.follow(Number.MAX_SAFE_INTEGER, (event) => huge.push(event));
    expect(huge.some((event) => event.kind === "gap")).toBe(false);
    const stopped: RemoteConsoleEvent[] = [];
    const stop = session.follow(0, (event) => stopped.push(event));
    stop();
    const count = stopped.length;
    session.close();
    expect(stopped).toHaveLength(count);
  });

  it("reports a gap when bounded history dropped output", async () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size);
    rig.fake.first(true);
    await settle();
    for (let index = 0; index < 40; index += 1)
      rig.requests[0]?.onOutput("x".repeat(8192));
    const replayed: RemoteConsoleEvent[] = [];
    session.replay(1, (event) => replayed.push(event));
    expect(replayed[0]?.kind).toBe("gap");
    const none: RemoteConsoleEvent[] = [];
    session.replay(0, (event) => none.push(event));
    expect(none[0]?.kind).not.toBe("gap");
  });
});

describe("RemoteConsoleSession writing and closing", () => {
  it("refuses input when not connected", () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size);
    expect(() => session.write("x", 0)).toThrow(RemoteError);
  });

  it("closes a connected shell once", async () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size);
    rig.fake.first(true);
    await settle();
    session.close("remote.error.x");
    session.close();
    expect(rig.fake.close).toHaveBeenCalledTimes(1);
    expect(session.view()).toMatchObject({
      status: "ended",
      message: "remote.error.x",
    });
  });
});

describe("RemoteConsoleSession exit", () => {
  async function connected(
    options: Parameters<typeof rigOf>[0] = {},
  ): Promise<{ rig: Rig; session: RemoteConsoleSession }> {
    const rig = rigOf(options);
    const session = new RemoteConsoleSession(async () => rig.target, size);
    rig.fake.first(true);
    await settle();
    return { rig, session };
  }

  it("ends after a normal exit", async () => {
    const { rig, session } = await connected();
    rig.fake.exit(3);
    await settle();
    expect(session.view()).toMatchObject({ status: "ended", exitCode: 3 });
  });

  it("blocks after a refused terminal", async () => {
    const { rig, session } = await connected();
    rig.fake.wasRefused.mockReturnValue(true);
    rig.fake.exit(1);
    await settle();
    expect(session.view().message).toBe("remote.console.ptyUnavailable");
  });

  it("ignores the exit of a closed generation", async () => {
    const { rig, session } = await connected();
    session.close();
    rig.fake.exit(0);
    await settle();
    expect(session.view().exitCode).toBeNull();
  });

  it("retries a lost transport after a connected shell", async () => {
    const { rig, session } = await connected();
    rig.fake.exit(255);
    await settle();
    expect(session.view().status).toBe("reconnecting");
    const second = ptyOf();
    rig.openPty.mockResolvedValueOnce(second.pty);
    second.first(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(session.view()).toMatchObject({ status: "connected", attempts: 1 });
  });

  it("blocks a lost transport before any shell ran", async () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size);
    await settle();
    rig.fake.exit(255);
    await settle();
    expect(session.view().message).toBe("remote.failure.transport_lost");
    expect(session.view().status).toBe("blocked");
  });

  it("blocks when the retry budget is used up", async () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size, {
      lastSequence: 0,
      attempts: 10,
    });
    rig.fake.first(true);
    await settle();
    rig.fake.exit(255);
    await settle();
    expect(session.view().status).toBe("blocked");
  });
});

describe("RemoteConsoleSession failed retry", () => {
  it("keeps reconnecting after a failed retry", async () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size);
    rig.fake.first(true);
    await settle();
    rig.fake.exit(255);
    rig.openPty.mockRejectedValue(
      new RemoteError("remote_blocked", "host_unknown"),
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(session.view().status).toBe("reconnecting");
    session.close();
  });
});

describe("RemoteConsoleSession reconnect", () => {
  async function blocked(
    options: Parameters<typeof rigOf>[0] = {},
    restored?: { lastSequence: number; attempts: number },
  ): Promise<{ rig: Rig; session: RemoteConsoleSession }> {
    const rig = rigOf(options);
    rig.openPty.mockRejectedValueOnce(new RemoteError("remote_blocked"));
    const session = new RemoteConsoleSession(
      async () => rig.target,
      size,
      restored,
    );
    await settle();
    return { rig, session };
  }

  it("ignores a console that is not blocked or has no attempts left", async () => {
    const rig = rigOf();
    new RemoteConsoleSession(async () => rig.target, size).reconnect();
    const { session } = await blocked({}, { lastSequence: 0, attempts: 10 });
    session.reconnect();
    expect(session.view().status).toBe("blocked");
  });

  it("never retries a changed host key", async () => {
    const rig = rigOf();
    rig.openPty.mockRejectedValueOnce(
      new RemoteError("remote_blocked", "host_key_changed"),
    );
    const session = new RemoteConsoleSession(async () => rig.target, size);
    await settle();
    session.reconnect();
    expect(session.view().status).toBe("blocked");
  });

  it("never restarts a conducted command that started", async () => {
    const conductor = conductorOf({ hasStarted: vi.fn(() => true) });
    const { session } = await blocked({ conductor });
    session.reconnect();
    expect(session.view().status).toBe("blocked");
    expect(conductor.abort).toHaveBeenCalled();
  });

  it("connects again before any shell ran", async () => {
    const { rig, session } = await blocked();
    rig.fake.first(true);
    session.reconnect();
    await settle();
    expect(session.view()).toMatchObject({ status: "connected", attempts: 1 });
    expect(rig.attemptNow).toHaveBeenCalledTimes(2);
  });

  it("schedules a retry for a blocked console that connected before", async () => {
    const rig = rigOf();
    const session = new RemoteConsoleSession(async () => rig.target, size);
    rig.fake.first(true);
    await settle();
    rig.fake.wasRefused.mockReturnValue(true);
    rig.fake.exit(1);
    await settle();
    expect(session.view().status).toBe("blocked");
    session.reconnect();
    expect(session.view().status).toBe("reconnecting");
    session.reconnect();
    session.close();
  });
});

describe("RemoteConsoleSession conductor", () => {
  it("filters output, reports progress and writes input", async () => {
    const conductor = conductorOf();
    const rig = rigOf({ conductor });
    const session = new RemoteConsoleSession(async () => rig.target, size);
    const events = collect(session);
    rig.fake.first(true);
    await settle();
    rig.requests[0]?.onOutput("abc");
    expect(events.some((e) => e.kind === "output" && e.chunk === "ABC")).toBe(
      true,
    );
    const control = conductor.control[0];
    control?.report(progress);
    control?.write("hello");
    expect(rig.fake.write).toHaveBeenCalledWith("hello");
    expect(conductor.terminalOpened).toHaveBeenCalled();
    rig.fake.exit(0);
    await settle();
    expect(session.view().status).toBe("ended");
    control?.report(progress);
    expect(conductor.finish).toHaveBeenCalledWith(
      { exitCode: 0, isTransportFailure: false },
      control,
    );
  });

  it("ignores input while the result is verified", async () => {
    const pending = deferred<void>();
    const conductor = conductorOf({ finish: vi.fn(() => pending.promise) });
    const rig = rigOf({ conductor });
    const session = new RemoteConsoleSession(async () => rig.target, size);
    rig.fake.first(true);
    await settle();
    rig.fake.exit(0);
    await settle();
    expect(() => session.write("x", 0)).not.toThrow();
    pending.resolve();
    await settle();
  });

  it("blocks a conducted run whose transport failed", async () => {
    const conductor = conductorOf({
      finish: vi.fn(async () => {
        throw new Error("verify");
      }),
    });
    const rig = rigOf({ conductor });
    const session = new RemoteConsoleSession(async () => rig.target, size);
    rig.fake.first(true);
    await settle();
    rig.fake.exit(255);
    await settle();
    expect(session.view()).toMatchObject({
      status: "blocked",
      message: "remote.failure.transport_lost",
    });
    session.reconnect();
  });

  it("does not report the end of a closed conducted run", async () => {
    const pending = deferred<void>();
    const conductor = conductorOf({ finish: vi.fn(() => pending.promise) });
    const rig = rigOf({ conductor });
    const session = new RemoteConsoleSession(async () => rig.target, size);
    rig.fake.first(true);
    await settle();
    rig.fake.exit(0);
    await settle();
    session.close();
    pending.resolve();
    await settle();
    expect(session.view().exitCode).toBeNull();
  });
});
