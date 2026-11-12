import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteSession } from "@/backend/remote/RemoteSession";

import type { SshMaster, SshMasterResult } from "@/backend/remote/SshClient";
import type { SshTarget } from "@/backend/remote/SshOptions";
import type { SshProcessResult } from "@/backend/remote/SshProcess";

const RESULT: SshProcessResult = {
  exitCode: 0,
  stdout: "result",
  stderr: "",
  isTimedOut: false,
  isUnavailable: false,
};
const TARGET: SshTarget = {
  alias: "test",
  host: "example.invalid",
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

interface SessionFake {
  session: RemoteSession;
  master: SshMaster;
  run: ReturnType<
    typeof vi.fn<
      (command: string, timeout: number) => Promise<SshProcessResult>
    >
  >;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  openMaster: ReturnType<typeof vi.fn<() => Promise<SshMasterResult>>>;
  record: ReturnType<typeof vi.fn<() => Promise<void>>>;
  connected: ReturnType<typeof vi.fn>;
  exit: (result: SshProcessResult) => void;
}

function setup(): SessionFake {
  const run = vi
    .fn<(command: string, timeout: number) => Promise<SshProcessResult>>()
    .mockResolvedValue(RESULT);
  const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  let exit: (result: SshProcessResult) => void = () => undefined;
  const exited = new Promise<SshProcessResult>((resolve) => {
    exit = resolve;
  });
  const master: SshMaster = { run, close, exited };
  const openMaster = vi
    .fn<() => Promise<SshMasterResult>>()
    .mockResolvedValue({ master, failure: null });
  const record = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const connected = vi.fn();
  const session = new RemoteSession({
    client: { openMaster },
    target: async () => TARGET,
    record,
    connected,
    idleMilliseconds: 100,
    delays: [10],
  });
  return { session, master, run, close, openMaster, record, connected, exit };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RemoteSession", () => {
  it("shares an open master and closes it after inactivity", async () => {
    vi.useFakeTimers();
    const fake = setup();
    expect(await fake.session.run("first", 500)).toEqual(RESULT);
    expect(await fake.session.run("second", 600)).toEqual(RESULT);
    expect(fake.openMaster).toHaveBeenCalledOnce();
    expect(fake.run).toHaveBeenNthCalledWith(2, "second", 600);
    expect(fake.record).toHaveBeenCalledWith(null);
    expect(fake.connected).toHaveBeenCalledOnce();
    expect(fake.session.view().status).toBe("connected");
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.close).toHaveBeenCalledOnce();
    expect(fake.session.view().status).toBe("idle");
  });

  it("classifies command failures and does not repeat commands", async () => {
    const fake = setup();
    fake.run
      .mockResolvedValueOnce({ ...RESULT, isTimedOut: true })
      .mockResolvedValueOnce({ ...RESULT, exitCode: 255 })
      .mockResolvedValueOnce({ ...RESULT, isUnavailable: true });
    await expect(fake.session.run("timeout", 1)).rejects.toMatchObject({
      code: "remote_check_failed",
      failure: "unreachable_timeout",
    });
    await expect(fake.session.run("lost", 1)).rejects.toMatchObject({
      code: "remote_transport_lost",
      failure: "transport_lost",
    });
    await expect(fake.session.run("missing", 1)).rejects.toMatchObject({
      code: "remote_transport_lost",
      failure: "transport_lost",
    });
    expect(fake.run).toHaveBeenCalledTimes(3);
    await fake.session.close();
  });

  it("retries unreachable connections and blocks after the bounded series", async () => {
    vi.useFakeTimers();
    const fake = setup();
    fake.openMaster.mockResolvedValue({
      master: null,
      failure: "unreachable_refused",
    });
    await expect(fake.session.run("command", 10)).rejects.toMatchObject({
      code: "remote_check_failed",
      failure: "unreachable_refused",
    });
    await expect(fake.session.run("command", 10)).rejects.toMatchObject({
      code: "remote_reconnecting",
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.session.view()).toMatchObject({
      status: "blocked",
      attempts: 10,
      cause: "unreachable_refused",
      nextAttemptAt: null,
    });
    await expect(fake.session.run("command", 10)).rejects.toMatchObject({
      code: "remote_blocked",
    });
    fake.openMaster.mockResolvedValue({ master: fake.master, failure: null });
    await fake.session.attemptNow();
    expect(fake.session.view()).toMatchObject({
      status: "connected",
      attempts: 0,
      cause: null,
    });
    await fake.session.close();
  });
});

describe("RemoteSession transport lifecycle", () => {
  it("starts a reconnect series when the transport exits", async () => {
    vi.useFakeTimers();
    const fake = setup();
    await fake.session.run("command", 10);
    fake.exit(RESULT);
    await Promise.resolve();
    expect(fake.session.view()).toMatchObject({
      status: "reconnecting",
      cause: "transport_lost",
    });
    const replacement = setup();
    fake.openMaster.mockResolvedValue({
      master: replacement.master,
      failure: null,
    });
    await fake.session.attemptNow();
    expect(fake.openMaster).toHaveBeenCalledTimes(2);
    expect(fake.session.view().status).toBe("connected");
    await fake.session.close();
  });

  it("does not retry a failure requiring user input", async () => {
    const fake = setup();
    fake.openMaster.mockResolvedValue({
      master: null,
      failure: "secret_missing",
    });
    await expect(fake.session.run("command", 10)).rejects.toMatchObject({
      failure: "secret_missing",
    });
    expect(fake.session.view()).toMatchObject({
      status: "idle",
      cause: "secret_missing",
    });
    fake.session.retryAfter("secret_missing");
    expect(fake.openMaster).toHaveBeenCalledOnce();
  });
});
