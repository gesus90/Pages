import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, expect, it, vi } from "vitest";

import { TemporaryPostgres } from "@/scripts/postgres-check/temporary-instance";

const boundary = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdir: vi.fn(async () => undefined),
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}private`),
  writeFile: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  createServer: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: boundary.spawn }));
vi.mock("node:fs/promises", () => ({
  ...boundary,
  access: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("node:net", () => ({ createServer: boundary.createServer }));

function childProcess(): EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: null;
} {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TMPDIR", `/disk/${"long-directory/".repeat(12)}`);
  boundary.createServer.mockImplementation(() => ({
    on: vi.fn(),
    listen: (_port: number, _address: string, ready: () => void) => ready(),
    address: () => ({ port: 54321 }),
    close: (closed: () => void) => closed(),
  }));
  boundary.spawn.mockImplementation((file: string) => {
    const child = childProcess();
    queueMicrotask(() => {
      if (file === "python3") child.stdout.emit("data", Buffer.from("owned\n"));
      else child.emit("close", 0);
    });
    child.stdin.on("finish", () => {
      child.exitCode = 0;
      child.emit("exit", 0);
      child.emit("close", 0);
    });
    return child;
  });
});

it("honors a long TMPDIR, uses TCP readiness, stops the exact owned server and deletes its files", async () => {
  const instance = await TemporaryPostgres.prepare();
  expect(instance.directory.startsWith(process.env.TMPDIR ?? "missing")).toBe(
    true,
  );
  await instance.start();
  expect(
    boundary.spawn.mock.calls.some(([, args]) =>
      args.includes("unix_socket_directories="),
    ),
  ).toBe(true);
  expect(
    boundary.spawn.mock.calls.some(([, args]) =>
      args.includes("--host=127.0.0.1"),
    ),
  ).toBe(true);
  expect(boundary.rm).not.toHaveBeenCalled();
  await instance.remove();
  await instance.remove();
  expect(boundary.rm).toHaveBeenCalledExactlyOnceWith(instance.directory, {
    recursive: true,
    force: true,
  });
});

it("removes a prepared instance even when initdb fails", async () => {
  boundary.spawn.mockImplementation(() => {
    const child = childProcess();
    queueMicrotask(() => child.emit("close", 1));
    return child;
  });
  const instance = await TemporaryPostgres.prepare();
  await expect(instance.start()).rejects.toThrow("initdb failed");
  await instance.remove();
  expect(boundary.rm).toHaveBeenCalledWith(instance.directory, {
    recursive: true,
    force: true,
  });
});

it("stops PostgreSQL on cancellation and waits until final cleanup to delete files", async () => {
  const controller = new AbortController();
  const instance = await TemporaryPostgres.prepare(controller.signal);
  await instance.start();
  controller.abort();
  expect(boundary.rm).not.toHaveBeenCalled();
  await instance.remove();
  expect(boundary.rm).toHaveBeenCalledTimes(1);
});
