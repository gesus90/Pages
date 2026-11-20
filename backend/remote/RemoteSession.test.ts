import { afterEach, expect, it, vi } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { REMOTE_RECONNECT_MAXIMUM_ATTEMPTS } from "@/definition/RemoteConnection";

const terminalBoundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("@lydell/node-pty", () => ({ spawn: terminalBoundary.spawn }));

import { RemoteSession } from "./RemoteSession";
import { openSshPty } from "./SshPty";

import type { RemoteSessionDependencies } from "./RemoteSession";
import type { SshMaster, SshMasterResult } from "./SshClient";
import type { SshTarget } from "./SshOptions";
import type { SshProcessResult } from "./SshProcess";

const target: SshTarget = {
  alias: "example",
  host: "example.test",
  port: 22,
  username: "user",
  hostKey: { algorithm: "ssh-ed25519", key: "key", fingerprint: "fingerprint" },
  credentials: {
    method: "password",
    password: "secret",
    privateKey: null,
    passphrase: null,
  },
};
const success: SshProcessResult = {
  exitCode: 0,
  stdout: "ok",
  stderr: "",
  isTimedOut: false,
  isUnavailable: false,
};

function masterFixture(): {
  master: SshMaster;
  run: ReturnType<typeof vi.fn<SshMaster["run"]>>;
  close: ReturnType<typeof vi.fn<SshMaster["close"]>>;
  exit: (result: SshProcessResult) => void;
} {
  let exit: (result: SshProcessResult) => void = () => {};
  const exited = new Promise<SshProcessResult>((resolve) => {
    exit = resolve;
  });
  const run = vi.fn<SshMaster["run"]>().mockResolvedValue(success);
  const close = vi.fn<SshMaster["close"]>().mockResolvedValue(undefined);
  return { master: { exited, run, close }, run, close, exit };
}

function fixture(overrides: Partial<RemoteSessionDependencies> = {}): {
  session: RemoteSession;
  open: ReturnType<
    typeof vi.fn<RemoteSessionDependencies["client"]["openMaster"]>
  >;
  record: ReturnType<typeof vi.fn<RemoteSessionDependencies["record"]>>;
  connected: ReturnType<typeof vi.fn>;
} {
  const open = vi.fn<RemoteSessionDependencies["client"]["openMaster"]>();
  const record = vi
    .fn<RemoteSessionDependencies["record"]>()
    .mockResolvedValue(undefined);
  const connected = vi.fn();
  const session = new RemoteSession({
    client: { openMaster: open },
    target: async () => target,
    record,
    connected,
    delays: [100],
    idleMilliseconds: 1000,
    ...overrides,
  });
  return { session, open, record, connected };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("shares an opening connection, runs commands once, and closes after inactivity", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const { session, open, record, connected } = fixture();
  const transport = masterFixture();
  open.mockResolvedValue({ master: transport.master, failure: null });
  const results = await Promise.all([
    session.run("one", 20),
    session.run("two", 30),
  ]);
  expect(results).toEqual([success, success]);
  expect(open).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledWith(target);
  expect(transport.run.mock.calls).toEqual([
    ["one", 20],
    ["two", 30],
  ]);
  expect(record).toHaveBeenCalledExactlyOnceWith(null);
  expect(connected).toHaveBeenCalledOnce();
  expect(session.view()).toMatchObject({
    status: "connected",
    connectedAt: "2026-01-01T00:00:00.000Z",
    attempts: 0,
  });
  await vi.advanceTimersByTimeAsync(999);
  expect(transport.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.close).toHaveBeenCalledOnce();
  expect(session.view().status).toBe("idle");
  transport.exit(success);
  await Promise.resolve();
  expect(session.view().status).toBe("idle");
});

it.each([
  [{ isTimedOut: true }, "remote_check_failed", "unreachable_timeout"],
  [{ isUnavailable: true }, "remote_transport_lost", "transport_lost"],
  [{ exitCode: 255 }, "remote_transport_lost", "transport_lost"],
])(
  "reports command transport problems without repeating commands",
  async (change, code, failure) => {
    const { session, open } = fixture();
    const transport = masterFixture();
    transport.run.mockResolvedValue({ ...success, ...change });
    open.mockResolvedValue({ master: transport.master, failure: null });
    await expect(session.run("command", 50)).rejects.toMatchObject({
      code,
      failure,
    });
    expect(transport.run).toHaveBeenCalledOnce();
    await session.close();
  },
);

it("starts reconnecting after a retryable first failure and resumes on an explicit attempt", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const { session, open, record } = fixture();
  const transport = masterFixture();
  open
    .mockResolvedValueOnce({ master: null, failure: "unreachable_refused" })
    .mockResolvedValueOnce({ master: transport.master, failure: null });
  await expect(session.run("first", 1)).rejects.toMatchObject({
    code: "remote_check_failed",
    failure: "unreachable_refused",
  });
  expect(session.view()).toMatchObject({
    status: "reconnecting",
    attempts: 0,
    nextAttemptAt: "1970-01-01T00:00:00.100Z",
  });
  await expect(session.run("second", 1)).rejects.toMatchObject({
    code: "remote_reconnecting",
  });
  await session.attemptNow();
  expect(session.view()).toMatchObject({
    status: "connected",
    attempts: 0,
    cause: null,
  });
  expect(record.mock.calls).toEqual([["unreachable_refused"], [null]]);
  await expect(session.run("third", 1)).resolves.toEqual(success);
  expect(transport.run).toHaveBeenCalledExactlyOnceWith("third", 1);
  await session.close();
});

it("retries lost transports, blocks after the limit and permits a fresh series", async () => {
  vi.useFakeTimers();
  const { session, open } = fixture();
  const first = masterFixture();
  const replacement = masterFixture();
  open
    .mockResolvedValueOnce({ master: first.master, failure: null })
    .mockResolvedValue({ master: null, failure: "unreachable_timeout" });
  await session.run("once", 1);
  first.exit(success);
  await Promise.resolve();
  expect(session.view()).toMatchObject({
    status: "reconnecting",
    cause: "transport_lost",
  });
  for (
    let attempt = 0;
    attempt < REMOTE_RECONNECT_MAXIMUM_ATTEMPTS;
    attempt += 1
  )
    await vi.advanceTimersByTimeAsync(100);
  expect(session.view()).toMatchObject({
    status: "blocked",
    attempts: REMOTE_RECONNECT_MAXIMUM_ATTEMPTS,
    cause: "unreachable_timeout",
    nextAttemptAt: null,
  });
  await expect(session.run("blocked", 1)).rejects.toMatchObject({
    code: "remote_blocked",
  });
  open.mockResolvedValueOnce({ master: replacement.master, failure: null });
  await session.attemptNow();
  expect(session.view()).toMatchObject({ status: "connected", attempts: 0 });
  await session.close();
});

it("does not retry failures requiring intervention and classifies thrown failures", async () => {
  const { session, open, record } = fixture();
  open
    .mockResolvedValueOnce({ master: null, failure: "host_key_changed" })
    .mockRejectedValueOnce(
      new RemoteError("remote_check_failed", "secret_missing"),
    )
    .mockRejectedValueOnce(new Error("offline"));
  for (const failure of [
    "host_key_changed",
    "secret_missing",
    "remote_failed",
  ]) {
    await expect(session.run("once", 1)).rejects.toMatchObject({
      code: "remote_check_failed",
      failure,
    });
    expect(session.view().status).toBe("idle");
  }
  expect(record.mock.calls).toEqual([
    ["host_key_changed"],
    ["secret_missing"],
    ["remote_failed"],
  ]);
  await session.close();
});

it("discards a connection that completes after close", async () => {
  const { session, open } = fixture();
  const transport = masterFixture();
  let resolve: (result: SshMasterResult) => void = () => {};
  open.mockImplementationOnce(
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  const running = session.run("command", 1);
  await Promise.resolve();
  await session.close();
  resolve({ master: transport.master, failure: null });
  await expect(running).rejects.toMatchObject({
    code: "remote_transport_lost",
  });
  expect(transport.close).toHaveBeenCalledOnce();
  expect(transport.run).not.toHaveBeenCalled();
  expect(session.view().status).toBe("idle");
});

it("holds the connection during an interactive terminal and closes it after exit", async () => {
  vi.useFakeTimers();
  let terminalExit: (event: { exitCode: number }) => void = () => {};
  const terminal = {
    onData: vi.fn(),
    onExit: vi.fn((listener: (event: { exitCode: number }) => void) => {
      terminalExit = listener;
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
  terminalBoundary.spawn.mockReturnValue(terminal);
  const request = { path: null, columns: 80, rows: 24, onOutput: vi.fn() };
  const pty = await openSshPty({
    file: "ssh",
    arguments: [],
    environment: {},
    directory: "/private",
    request,
  });
  const { session, open } = fixture();
  const transport = masterFixture();
  const openPty = vi
    .fn<NonNullable<SshMaster["openPty"]>>()
    .mockResolvedValue(pty);
  open.mockResolvedValue({
    master: { ...transport.master, openPty },
    failure: null,
  });
  expect(await session.openPty(request)).toBe(pty);
  await vi.advanceTimersByTimeAsync(2000);
  expect(transport.close).not.toHaveBeenCalled();
  terminalExit({ exitCode: 0 });
  await pty.exited;
  await vi.advanceTimersByTimeAsync(1000);
  expect(transport.close).toHaveBeenCalledOnce();
  await session.close();
});

it("reports unavailable and rejected terminals and releases idle holds", async () => {
  vi.useFakeTimers();
  const request = { path: null, columns: 80, rows: 24, onOutput: vi.fn() };
  const missing = fixture();
  const first = masterFixture();
  missing.open.mockResolvedValue({ master: first.master, failure: null });
  await expect(missing.session.openPty(request)).rejects.toMatchObject({
    code: "remote_check_failed",
    failure: "ssh_unavailable",
  });
  await missing.session.close();
  const failed = fixture();
  const second = masterFixture();
  const openPty = vi
    .fn<NonNullable<SshMaster["openPty"]>>()
    .mockRejectedValue(new Error("terminal failed"));
  failed.open.mockResolvedValue({
    master: { ...second.master, openPty },
    failure: null,
  });
  await expect(failed.session.openPty(request)).rejects.toThrow(
    "terminal failed",
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(second.close).toHaveBeenCalledOnce();
  await failed.session.close();
});

it("discards a reconnect that finishes after the session closes", async () => {
  vi.useFakeTimers();
  const { session, open } = fixture();
  const late = masterFixture();
  let resolve: (result: SshMasterResult) => void = () => {};
  open.mockImplementationOnce(
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  session.retryAfter("unreachable_timeout");
  const pending = session.attemptNow();
  await Promise.resolve();
  await session.close();
  resolve({ master: late.master, failure: null });
  await pending;
  expect(late.close).toHaveBeenCalledOnce();
  expect(session.view().status).toBe("idle");
});

it("ignores record failures and cancels a scheduled retry on close", async () => {
  vi.useFakeTimers();
  const { session, open, record } = fixture();
  record.mockRejectedValue(new Error("write failed"));
  open.mockResolvedValue({ master: null, failure: "unreachable_timeout" });
  await expect(session.run("command", 1)).rejects.toMatchObject({
    code: "remote_check_failed",
    failure: "unreachable_timeout",
  });
  expect(session.view().status).toBe("reconnecting");
  await session.close();
  await vi.advanceTimersByTimeAsync(1000);
  expect(open).toHaveBeenCalledOnce();
  expect(session.view().status).toBe("idle");
});

it("refuses terminals throughout reconnect and blocked states and uses default delays", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const { session, open } = fixture({
    delays: undefined,
    idleMilliseconds: undefined,
  });
  const request = { path: null, columns: 80, rows: 24, onOutput: vi.fn() };
  open.mockResolvedValue({ master: null, failure: "unreachable_timeout" });
  session.reconnect();
  expect(session.view().status).toBe("idle");
  session.retryAfter("unreachable_timeout");
  expect(session.view().nextAttemptAt).toBe("1970-01-01T00:00:01.000Z");
  await expect(session.openPty(request)).rejects.toMatchObject({
    code: "remote_reconnecting",
  });
  for (
    let attempt = 0;
    attempt < REMOTE_RECONNECT_MAXIMUM_ATTEMPTS;
    attempt += 1
  )
    await session.attemptNow();
  expect(session.view().status).toBe("blocked");
  await expect(session.openPty(request)).rejects.toMatchObject({
    code: "remote_blocked",
  });
  await session.close();
});

it("keeps an unused master open for the default idle period", async () => {
  vi.useFakeTimers();
  const { session, open } = fixture({ idleMilliseconds: undefined });
  const transport = masterFixture();
  open.mockResolvedValue({ master: transport.master, failure: null });
  await session.run("true", 100);
  await vi.advanceTimersByTimeAsync(599999);
  expect(transport.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.close).toHaveBeenCalledOnce();
  await session.close();
});

it("does not let an old reconnect clear a newer in-flight attempt", async () => {
  vi.useFakeTimers();
  const { session, open } = fixture();
  const stale = masterFixture();
  const current = masterFixture();
  let finishOld: (result: SshMasterResult) => void = () => {};
  let finishNew: (result: SshMasterResult) => void = () => {};
  open
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve;
        }),
    );
  session.retryAfter("unreachable_timeout");
  const oldAttempt = session.attemptNow();
  await Promise.resolve();
  await session.close();
  session.retryAfter("unreachable_refused");
  const newAttempt = session.attemptNow();
  await Promise.resolve();
  finishOld({ master: stale.master, failure: null });
  await oldAttempt;
  expect(stale.close).toHaveBeenCalledOnce();
  expect(session.view().status).toBe("reconnecting");
  let isWaiting = true;
  const sameAttempt = session.attemptNow().then(() => {
    isWaiting = false;
  });
  await Promise.resolve();
  expect(isWaiting).toBe(true);
  expect(open).toHaveBeenCalledTimes(2);
  finishNew({ master: current.master, failure: null });
  await Promise.all([newAttempt, sameAttempt]);
  expect(session.view().status).toBe("connected");
  await session.close();
});

it("ignores a failed reconnect that completes after the session is closed", async () => {
  vi.useFakeTimers();
  const { session, open, record } = fixture();
  let finish: (result: SshMasterResult) => void = () => {};
  open.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  session.retryAfter("unreachable_timeout");
  const attempt = session.attemptNow();
  await Promise.resolve();
  await session.close();
  finish({ master: null, failure: "host_key_changed" });
  await attempt;
  expect(record).toHaveBeenCalledExactlyOnceWith("host_key_changed");
  expect(session.view()).toMatchObject({
    status: "idle",
    attempts: 0,
    cause: null,
    nextAttemptAt: null,
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(open).toHaveBeenCalledOnce();
});

it("does not close an idle connection while a concurrent command is running", async () => {
  vi.useFakeTimers();
  const { session, open } = fixture();
  const transport = masterFixture();
  let finish: (result: SshProcessResult) => void = () => {};
  transport.run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  open.mockResolvedValue({ master: transport.master, failure: null });
  const pending = session.run("slow", 5000);
  await Promise.resolve();
  await session.run("fast", 5000);
  await vi.advanceTimersByTimeAsync(2000);
  expect(transport.close).not.toHaveBeenCalled();
  finish(success);
  await expect(pending).resolves.toEqual(success);
  await vi.advanceTimersByTimeAsync(1000);
  expect(transport.close).toHaveBeenCalledOnce();
  expect(transport.run.mock.calls).toEqual([
    ["slow", 5000],
    ["fast", 5000],
  ]);
  await session.close();
});
