import { EventEmitter } from "node:events";

import { afterEach, expect, it, vi } from "vitest";

const sockets = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("node:net", () => ({ connect: sockets.connect }));

import { probeSshEndpoint } from "./SshProbe";

class FakeSocket extends EventEmitter {
  public readonly destroy = vi.fn();
}

function startProbe(): {
  socket: FakeSocket;
  result: ReturnType<typeof probeSshEndpoint>;
} {
  const socket = new FakeSocket();
  sockets.connect.mockReturnValue(socket);
  return {
    socket,
    result: probeSshEndpoint({ host: "example.test", port: 22 }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  sockets.connect.mockReset();
});

it("recognizes an SSH greeting after a banner", async () => {
  const { socket, result } = startProbe();
  socket.emit("connect");
  socket.emit("data", Buffer.from("banner\n"));
  socket.emit("data", Buffer.from("SSH-2.0-test\r\n"));
  await expect(result).resolves.toBeNull();
  expect(socket.destroy).toHaveBeenCalledOnce();
  socket.emit("close");
  expect(sockets.connect).toHaveBeenCalledWith({
    host: "example.test",
    port: 22,
  });
});

it("classifies errors without a network error code", async () => {
  const { socket, result } = startProbe();
  socket.emit("error", new Error("failure"));
  await expect(result).resolves.toBe("not_ssh");
});

it.each([
  ["ENOTFOUND", "host_unknown"],
  ["ECONNREFUSED", "unreachable_refused"],
  ["ETIMEDOUT", "unreachable_timeout"],
  ["ENETUNREACH", "unreachable_network"],
  ["other", "not_ssh"],
])("classifies network error %s", async (code, expected) => {
  const { socket, result } = startProbe();
  socket.emit("error", Object.assign(new Error("failed"), { code }));
  await expect(result).resolves.toBe(expected);
});

it("rejects non-SSH greetings and closed sockets", async () => {
  const oversized = startProbe();
  oversized.socket.emit("data", Buffer.from("x".repeat(4097)));
  await expect(oversized.result).resolves.toBe("not_ssh");
  const closed = startProbe();
  closed.socket.emit("close");
  await expect(closed.result).resolves.toBe("not_ssh");
});

it("distinguishes timeouts before and after connection", async () => {
  vi.useFakeTimers();
  const pending = startProbe();
  await vi.advanceTimersByTimeAsync(10000);
  await expect(pending.result).resolves.toBe("unreachable_timeout");
  const connected = startProbe();
  connected.socket.emit("connect");
  await vi.advanceTimersByTimeAsync(10000);
  await expect(connected.result).resolves.toBe("not_ssh");
});
