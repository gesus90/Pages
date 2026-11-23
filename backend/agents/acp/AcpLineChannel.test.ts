import { beforeEach, expect, it, vi } from "vitest";

import { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import { logCaughtError } from "@/backend/logging/Logger";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const NOTE = JSON.stringify({
  jsonrpc: "2.0",
  method: "session/update",
  params: {},
});
const REQ = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "x" });

beforeEach(() => {
  vi.mocked(logCaughtError).mockClear();
});

it("drops diagnostics and non-JSON-RPC lines", async () => {
  const channel = new AcpLineChannel();
  await channel.receive("not json");
  await channel.receive("[]");
  await channel.receive("null");
  await channel.receive('{"jsonrpc":"1"}');
  expect(logCaughtError).toHaveBeenCalledTimes(1);
});

it("keeps sensitive diagnostics out of the log", async () => {
  await new AcpLineChannel(true).receive("not json");
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("delivers messages and ends on close", async () => {
  const channel = new AcpLineChannel();
  const reader = channel.stream.readable.getReader();
  await channel.receive(REQ);
  expect((await reader.read()).value).toMatchObject({ id: 1 });
  channel.close();
  channel.close();
  expect((await reader.read()).done).toBe(true);
  await channel.receive(REQ);
});

it("writes messages through the attached input", async () => {
  const channel = new AcpLineChannel();
  const lines: string[] = [];
  channel.attach((line) => {
    lines.push(line);
    return true;
  });
  const writer = channel.stream.writable.getWriter();
  await writer.write({ jsonrpc: "2.0", id: 1, method: "x" });
  expect(lines).toEqual([REQ]);
});

it("fails a write without input or when the input is closed", async () => {
  const channel = new AcpLineChannel();
  const writer = channel.stream.writable.getWriter();
  await expect(
    writer.write({ jsonrpc: "2.0", id: 1, method: "x" }),
  ).rejects.toThrow("no longer reads");
});

it("waits for capacity when the queue is full and resumes on read", async () => {
  const channel = new AcpLineChannel();
  const reader = channel.stream.readable.getReader();
  await channel.receive(REQ);
  const second = channel.receive(REQ);
  let settled = false;
  void Promise.resolve(second).then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(settled).toBe(false);
  await reader.read();
  await second;
  expect((await reader.read()).value).toMatchObject({ id: 1 });
});

it("releases a waiting receiver on close", async () => {
  const channel = new AcpLineChannel();
  await channel.receive(REQ);
  const second = channel.receive(REQ);
  channel.close();
  await second;
});

it("releases a waiting receiver when the reader cancels", async () => {
  const channel = new AcpLineChannel();
  const reader = channel.stream.readable.getReader();
  await channel.receive(REQ);
  const second = channel.receive(REQ);
  await reader.cancel();
  await second;
  await channel.receive(REQ);
});

it("holds a session update until it is acknowledged", async () => {
  const channel = new AcpLineChannel();
  channel.enableAcknowledgement();
  const reader = channel.stream.readable.getReader();
  let settled = false;
  const pending = Promise.resolve(channel.receive(NOTE)).then(() => {
    settled = true;
  });
  await reader.read();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(settled).toBe(false);
  channel.acknowledge();
  await pending;
  await channel.receive(REQ);
  channel.acknowledge();
});

it("does not hold other messages when acknowledging", async () => {
  const channel = new AcpLineChannel();
  channel.enableAcknowledgement();
  await channel.receive(REQ);
  const plain = new AcpLineChannel();
  await plain.receive(NOTE);
});
