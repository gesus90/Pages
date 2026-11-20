import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type { SshTarget } from "./SshOptions";
import type { SshProcessRequest, SshProcessResult } from "./SshProcess";

const boundary = vi.hoisted(() => ({
  run: vi.fn<(request: SshProcessRequest) => Promise<SshProcessResult>>(),
  start: vi.fn<(request: SshProcessRequest) => void>(),
  stop: vi.fn(),
  probe: vi.fn(),
  terminal: vi.fn(),
  finish: (result: SshProcessResult): void => {
    void result;
  },
}));

vi.mock("./SshProcess", () => ({
  runSshProcess: boundary.run,
  SshChildProcess: class {
    public readonly exited: Promise<SshProcessResult>;
    public constructor(request: SshProcessRequest) {
      boundary.start(request);
      this.exited = new Promise((resolve) => {
        boundary.finish = resolve;
      });
    }
    /** Settles the simulated process when the client stops it. */
    public stop(): void {
      boundary.stop();
      boundary.finish({
        exitCode: 255,
        stdout: "",
        stderr: "Connection closed",
        isTimedOut: false,
        isUnavailable: false,
      });
    }
  },
}));
vi.mock("./SshProbe", () => ({ probeSshEndpoint: boundary.probe }));
vi.mock("@lydell/node-pty", () => ({ spawn: boundary.terminal }));

import { SshClient } from "./SshClient";
import { SshRuntimeDirectory } from "./SshRuntimeDirectory";

const result: SshProcessResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  isTimedOut: false,
  isUnavailable: false,
};
const blob = Buffer.concat([
  Buffer.from([0, 0, 0, 11]),
  Buffer.from("ssh-ed25519"),
  Buffer.from("key"),
]).toString("base64");
const target: SshTarget = {
  alias: "server",
  host: "example.test",
  port: 2222,
  username: "user",
  hostKey: { algorithm: "ssh-ed25519", key: blob, fingerprint: "fingerprint" },
  credentials: {
    method: "password",
    password: "secret",
    privateKey: null,
    passphrase: null,
  },
};
const tools = {
  ssh: "fake-ssh",
  keyscan: "fake-keyscan",
  keygen: "fake-keygen",
};
let directory = "";
let runtime: SshRuntimeDirectory;
let client: SshClient;

beforeEach(async () => {
  const root = pagesTempDirectory("ssh-client-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
  runtime = new SshRuntimeDirectory(directory);
  client = new SshClient(runtime, tools);
  boundary.run.mockReset();
  boundary.start.mockReset();
  boundary.stop.mockReset();
  boundary.probe.mockReset();
  boundary.terminal.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  await runtime.dispose();
  await rm(directory, { recursive: true, force: true });
});

it("probes and scans host keys using isolated process requests", async () => {
  boundary.probe.mockResolvedValue("not_ssh");
  await expect(
    client.probe({ host: "example.test", port: 2222 }),
  ).resolves.toBe("not_ssh");
  expect(boundary.probe).toHaveBeenCalledWith({
    host: "example.test",
    port: 2222,
  });
  boundary.run
    .mockResolvedValueOnce({ ...result, isUnavailable: true })
    .mockResolvedValueOnce(result)
    .mockResolvedValueOnce({
      ...result,
      stdout: `example.test ssh-ed25519 ${blob}\n`,
    });
  await expect(
    client.scanHostKey({ host: "example.test", port: 2222 }),
  ).resolves.toBe("ssh_unavailable");
  await expect(
    client.scanHostKey({ host: "example.test", port: 2222 }),
  ).resolves.toBe("host_key_unavailable");
  await expect(
    client.scanHostKey({ host: "example.test", port: 2222 }),
  ).resolves.toMatchObject({ algorithm: "ssh-ed25519", key: blob });
  expect(boundary.run.mock.calls[0][0]).toMatchObject({
    file: "fake-keyscan",
    arguments: [
      "-T",
      "10",
      "-p",
      "2222",
      "-t",
      "ed25519,ecdsa,rsa",
      "--",
      "example.test",
    ],
    timeoutMs: 15000,
  });
});

it("authenticates with a pinned key and removes the private scope", async () => {
  boundary.run.mockImplementationOnce(async (request) => {
    expect(request.file).toBe("fake-ssh");
    expect(request.arguments).toContain("StrictHostKeyChecking=yes");
    expect(request.arguments.slice(-3)).toEqual(["--", "example.test", "true"]);
    expect(request.environment.PAGES_SSH_SECRET).toBe("secret");
    const option = request.arguments.find((entry) =>
      entry.startsWith("UserKnownHostsFile="),
    );
    if (!option) throw new Error("Missing known hosts path");
    expect(
      await readFile(option.slice("UserKnownHostsFile=".length), "utf8"),
    ).toContain(`server ssh-ed25519 ${blob}`);
    return result;
  });
  await expect(client.authenticate(target)).resolves.toBeNull();
  const roots = await readdir(directory);
  expect(roots).toHaveLength(1);
  expect(await readdir(path.join(directory, roots[0]))).toEqual(["askpass"]);
  await client.dispose();
  expect(await readdir(directory)).toEqual([]);
});

it("rejects missing credentials and classifies refused authentication", async () => {
  await expect(
    client.authenticate({
      ...target,
      credentials: { ...target.credentials, password: null },
    }),
  ).resolves.toBe("secret_missing");
  expect(boundary.run).not.toHaveBeenCalled();
  boundary.run.mockResolvedValueOnce({
    ...result,
    exitCode: 255,
    stderr: "Permission denied",
  });
  await expect(client.authenticate(target)).resolves.toBe("password_rejected");
});

it("validates private keys before authentication and keeps their bytes in private files", async () => {
  const keyed: SshTarget = {
    ...target,
    credentials: {
      method: "key_passphrase",
      password: null,
      privateKey: "  key\r\nline  ",
      passphrase: "phrase",
    },
  };
  boundary.run
    .mockImplementationOnce(async (request) => {
      expect(request.file).toBe("fake-keygen");
      expect(request.environment.PAGES_SSH_SECRET).toBe("phrase");
      expect(await readFile(request.arguments[2], "utf8")).toBe("key\nline\n");
      return result;
    })
    .mockResolvedValueOnce(result);
  await expect(client.authenticate(keyed)).resolves.toBeNull();
  expect(boundary.run).toHaveBeenCalledTimes(2);
  await expect(
    client.authenticate({
      ...keyed,
      credentials: { ...keyed.credentials, privateKey: null },
    }),
  ).resolves.toBe("secret_missing");
  boundary.run.mockResolvedValueOnce({
    ...result,
    exitCode: 1,
    stderr: "incorrect passphrase",
  });
  await expect(client.authenticate(keyed)).resolves.toBe("passphrase_wrong");
  boundary.run.mockRejectedValueOnce(new Error("keygen failure"));
  await expect(client.authenticate(keyed)).resolves.toBe("key_invalid");
});

it("opens a master after its control check and closes it after commands", async () => {
  boundary.run.mockResolvedValue(result);
  const opened = await client.openMaster(target);
  if (!opened.master) throw new Error("Master did not open");
  expect(boundary.start).toHaveBeenCalledOnce();
  expect(boundary.start.mock.calls[0][0]).toMatchObject({
    file: "fake-ssh",
    timeoutMs: null,
  });
  expect(boundary.start.mock.calls[0][0].arguments).toContain(
    "ControlPersist=no",
  );
  expect(boundary.run.mock.calls[0][0].arguments).toContain("check");
  await expect(opened.master.run("printf ok", 1234)).resolves.toEqual(result);
  expect(boundary.run.mock.calls[1][0]).toMatchObject({
    file: "fake-ssh",
    timeoutMs: 1234,
  });
  expect(boundary.run.mock.calls[1][0].arguments.at(-1)).toBe("printf ok");
  await opened.master.close();
  expect(boundary.stop).toHaveBeenCalledOnce();
  const roots = await readdir(directory);
  await vi.waitFor(async () => {
    expect(await readdir(path.join(directory, roots[0]))).toEqual(["askpass"]);
  });
});

it("cleans failed master preparations and propagates unexpected filesystem errors", async () => {
  await expect(
    client.openMaster({
      ...target,
      credentials: { ...target.credentials, password: null },
    }),
  ).resolves.toEqual({ master: null, failure: "secret_missing" });
  expect(boundary.start).not.toHaveBeenCalled();
  const scope = await runtime.createScope();
  vi.spyOn(runtime, "createScope").mockResolvedValue({
    ...scope,
    write: vi.fn().mockRejectedValue(new Error("disk failed")),
  });
  await expect(client.openMaster(target)).rejects.toThrow("disk failed");
  await expect(readdir(scope.directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("stops a master that exits before its control socket is ready", async () => {
  boundary.run.mockImplementationOnce(async () => {
    boundary.finish({ ...result, exitCode: 255, stderr: "Permission denied" });
    return { ...result, exitCode: 1 };
  });
  vi.useFakeTimers();
  const opening = client.openMaster(target);
  await vi.waitFor(() => expect(boundary.run).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(250);
  await expect(opening).resolves.toEqual({
    master: null,
    failure: "password_rejected",
  });
  expect(boundary.stop).toHaveBeenCalledOnce();
});

it("closes active terminals with the master while leaving finished terminals alone", async () => {
  const listeners: ((event: { exitCode: number }) => void)[] = [];
  const first = {
    onData: vi.fn(),
    onExit: vi.fn((listener: (event: { exitCode: number }) => void) => {
      listeners.push(listener);
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
  const second = {
    onData: vi.fn(),
    onExit: vi.fn((listener: (event: { exitCode: number }) => void) => {
      listeners.push(listener);
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
  boundary.terminal.mockReturnValueOnce(first).mockReturnValueOnce(second);
  boundary.run.mockResolvedValue(result);
  const opened = await client.openMaster(target);
  if (!opened.master?.openPty) throw new Error("Master terminal unavailable");
  const request = { path: null, columns: 80, rows: 24, onOutput: vi.fn() };
  const finished = await opened.master.openPty(request);
  const active = await opened.master.openPty(request);
  expect(boundary.terminal).toHaveBeenCalledTimes(2);
  listeners[0]({ exitCode: 0 });
  await finished.exited;
  await Promise.resolve();
  await opened.master.close();
  expect(first.kill).not.toHaveBeenCalled();
  expect(second.kill).toHaveBeenCalledOnce();
  listeners[1]({ exitCode: 0 });
  await expect(active.exited).resolves.toBe(0);
  expect(boundary.stop).toHaveBeenCalledOnce();
});

it("logs cleanup failure after the master has exited without rejecting close", async () => {
  const logger = await import("@/backend/logging/Logger");
  const log = vi.spyOn(logger, "logCaughtError").mockImplementation(() => {});
  const scope = await runtime.createScope();
  const failure = new Error("cleanup failed");
  const remove = vi.fn<() => Promise<void>>().mockRejectedValue(failure);
  vi.spyOn(runtime, "createScope").mockResolvedValue({ ...scope, remove });
  boundary.run.mockResolvedValue(result);
  try {
    const opened = await client.openMaster(target);
    if (!opened.master) throw new Error("Master did not open");
    await expect(opened.master.close()).resolves.toBeUndefined();
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith("SshClient", failure),
    );
    expect(remove).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore();
  }
});

it("reports a failed control check even when the master exited successfully", async () => {
  boundary.run.mockImplementationOnce(async () => {
    boundary.finish(result);
    return { ...result, exitCode: 1 };
  });
  vi.useFakeTimers();
  const opening = client.openMaster(target);
  await vi.waitFor(() => expect(boundary.run).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(250);
  await expect(opening).resolves.toEqual({
    master: null,
    failure: "remote_failed",
  });
  expect(boundary.stop).toHaveBeenCalledOnce();
});
