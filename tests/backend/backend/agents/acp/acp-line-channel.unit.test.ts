import { afterEach, expect, it, vi } from "vitest";

import { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";

const logging = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logging);

afterEach(() => {
  logging.logCaughtError.mockReset();
});

const UPDATE = JSON.stringify({
  jsonrpc: "2.0",
  method: "session/update",
  params: { sessionId: "s-1" },
});

function response(id: number): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result: {} });
}

it("passes JSON-RPC lines to the message stream", async () => {
  const channel = new AcpLineChannel();
  const reader = channel.stream.readable.getReader();

  await channel.receive(response(1));

  await expect(reader.read()).resolves.toEqual({
    done: false,
    value: { jsonrpc: "2.0", id: 1, result: {} },
  });
});

it("drops diagnostics and lines that are no JSON-RPC message", async () => {
  const channel = new AcpLineChannel();
  const reader = channel.stream.readable.getReader();

  await channel.receive("not json");
  await channel.receive("[1, 2]");
  await channel.receive("null");
  await channel.receive(JSON.stringify({ jsonrpc: "1.0", id: 1 }));
  channel.close();

  await expect(reader.read()).resolves.toEqual({
    done: true,
    value: undefined,
  });
  expect(logging.logCaughtError).toHaveBeenCalledTimes(1);
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "AcpLineChannel",
    expect.any(SyntaxError),
  );
});

it("ignores lines after it was closed and closes only once", async () => {
  const channel = new AcpLineChannel();
  const reader = channel.stream.readable.getReader();

  channel.close();
  channel.close();
  await channel.receive(response(1));

  await expect(reader.read()).resolves.toMatchObject({ done: true });
});

it("writes messages as JSON lines to the attached input", async () => {
  const channel = new AcpLineChannel();
  const lines: string[] = [];
  channel.attach(async (line) => {
    lines.push(line);
    return true;
  });
  const writer = channel.stream.writable.getWriter();

  await writer.write({ jsonrpc: "2.0", id: 2, result: null });

  expect(lines).toEqual(['{"jsonrpc":"2.0","id":2,"result":null}']);
});

it("fails writes before the input is attached", async () => {
  const channel = new AcpLineChannel();
  const writer = channel.stream.writable.getWriter();

  await expect(
    writer.write({ jsonrpc: "2.0", id: 2, result: null }),
  ).rejects.toThrow("The ACP adapter no longer reads its input.");
});

it("fails writes the process input refuses", async () => {
  const channel = new AcpLineChannel();
  channel.attach(() => false);
  const writer = channel.stream.writable.getWriter();

  await expect(
    writer.write({ jsonrpc: "2.0", id: 2, result: null }),
  ).rejects.toThrow("The ACP adapter no longer reads its input.");
});

it("waits for reader capacity before it enqueues the next message", async () => {
  const channel = new AcpLineChannel();
  const reader = channel.stream.readable.getReader();
  await channel.receive(response(1));
  let isDelivered = false;

  const second = Promise.resolve(channel.receive(response(2))).then(() => {
    isDelivered = true;
  });
  await Promise.resolve();
  expect(isDelivered).toBe(false);
  await expect(reader.read()).resolves.toMatchObject({ value: { id: 1 } });
  await second;

  await expect(reader.read()).resolves.toMatchObject({ value: { id: 2 } });
});

it("drops a waiting message when the channel closes", async () => {
  const channel = new AcpLineChannel();
  const reader = channel.stream.readable.getReader();
  await channel.receive(response(1));

  const waiting = channel.receive(response(2));
  channel.close();
  await waiting;

  await expect(reader.read()).resolves.toMatchObject({ value: { id: 1 } });
  await expect(reader.read()).resolves.toMatchObject({ done: true });
});

it("holds the pipe until a journaled notification is acknowledged", async () => {
  const channel = new AcpLineChannel();
  channel.enableAcknowledgement();
  const reader = channel.stream.readable.getReader();
  let isReleased = false;

  const pending = Promise.resolve(channel.receive(UPDATE)).then(() => {
    isReleased = true;
  });
  await expect(reader.read()).resolves.toMatchObject({
    value: { method: "session/update" },
  });
  expect(isReleased).toBe(false);
  channel.acknowledge();
  await pending;

  expect(isReleased).toBe(true);
});

it("does not hold the pipe for responses even with acknowledgement", async () => {
  const channel = new AcpLineChannel();
  channel.enableAcknowledgement();

  await channel.receive(response(3));

  const reader = channel.stream.readable.getReader();
  await expect(reader.read()).resolves.toMatchObject({ value: { id: 3 } });
});

it("releases pending work when the reader cancels the stream", async () => {
  const channel = new AcpLineChannel();
  channel.enableAcknowledgement();
  const reader = channel.stream.readable.getReader();
  const pending = channel.receive(UPDATE);
  await reader.read();

  const waiting = channel.receive(response(4));
  await reader.cancel();
  await pending;
  await waiting;

  await channel.receive(response(5));
  channel.close();
  expect(logging.logCaughtError).not.toHaveBeenCalled();
});
