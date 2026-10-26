import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

import { expect, it, vi } from "vitest";

import { OpenCodeAcpClient } from "../../../../../scripts/runner/opencode.mjs";

function fixture(): {
  readonly child: ChildProcess;
  readonly stdout: PassThrough;
  readonly stdin: PassThrough;
} {
  const child = new ChildProcess();
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  Object.defineProperties(child, {
    stdout: { value: stdout },
    stdin: { value: stdin },
  });
  vi.spyOn(child, "kill").mockReturnValue(true);
  return { child, stdout, stdin };
}

function update(text: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } })}\n`;
}

it("reads split ACP UTF-8 and JSON and retains only the message after the last tool boundary", async () => {
  const { child, stdout } = fixture();
  const publish = vi.fn(async () => undefined);
  const client = new OpenCodeAcpClient(child, () => ({}), publish);
  const first = Buffer.from(update("Intermediate 🙂"));
  stdout.write(first.subarray(0, first.length - 7));
  stdout.write(first.subarray(first.length - 7));
  stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "tool", title: "synthetic" } } })}\n`,
  );
  await vi.waitFor(() =>
    expect(publish.mock.calls.length).toBeGreaterThanOrEqual(3),
  );
  expect(client.text).toBe("");
  stdout.write(update('{"ok":true}'));
  await vi.waitFor(() => expect(client.text).toBe('{"ok":true}'));
  await client.flushMessage();
  expect(client.text).toBe('{"ok":true}');
  child.emit("close");
  stdout.end();
});

it("limits one native message independently of cumulative protocol output", async () => {
  const { child, stdout } = fixture();
  const client = new OpenCodeAcpClient(child, () => ({}));
  for (let count = 0; count < 6; count += 1)
    stdout.write(update("x".repeat(200000)));
  await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith("SIGKILL"));
  expect(Buffer.byteLength(client.text)).toBeLessThanOrEqual(1048576);
  await expect(client.call("session/prompt", {})).rejects.toThrow(
    "exceeds 1 MiB",
  );
  stdout.end();
});

it("handles response identity and process loss without an unbounded pending request queue", async () => {
  const { child, stdout, stdin } = fixture();
  stdin.resume();
  const client = new OpenCodeAcpClient(child, () => ({}));
  const reply = client.call("initialize", {});
  stdout.write('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}\n');
  await expect(reply).resolves.toEqual({ protocolVersion: 1 });
  const pending = Array.from({ length: 8 }, () =>
    client.call("session/new", {}).catch((error: unknown) => error),
  );
  await expect(client.call("session/new", {})).rejects.toThrow("window full");
  child.emit("close");
  stdout.end();
  expect(
    (await Promise.all(pending)).every((error) => error instanceof Error),
  ).toBe(true);
});
